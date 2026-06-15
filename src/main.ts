import { emit, on, showUI } from '@create-figma-plugin/utilities'

import { materializeIR } from './mapper'
import type { IRImageFailure } from './types/ir'
import type {
  ImportCompleteHandler,
  ImportDocumentHandler,
  ImportDocumentsHandler,
  ImportErrorHandler,
  ImportProgressHandler,
  PingHandler,
  PongHandler,
  PluginSettings,
  SettingsChangedHandler,
  SettingsLoadedHandler
} from './types/messages'

const PLUGIN_VERSION = '0.3.0'
const SETTINGS_KEY = 'plugin-settings-v1'
const DEFAULT_SETTINGS: PluginSettings = {
  viewportWidth: 1440,
  linkInteractions: false
}
// Horizontal gutter between multi-page frames so they read as a
// storyboard, not a tile sheet. 100 px reads cleanly at 50% zoom.
const MULTI_PAGE_GAP = 100

// Resolve an internal href to one of the imported page frames by matching
// basenames. "catalogo.html", "./catalogo.html", "/pages/catalogo.html",
// and "catalogo.html#top" all resolve to a frame named "catalogo.html".
// Bare "/" or "" falls back to index.html. Returns null for external URLs
// or pages not part of this import.
function resolveTargetFrame(
  href: string,
  frameByName: Map<string, FrameNode>
): FrameNode | null {
  const path = href.split('#')[0].split('?')[0].trim()
  let base = path.split('/').pop() ?? ''
  if (base.length === 0) base = 'index.html'
  const direct = frameByName.get(base)
  if (direct) return direct
  const lower = base.toLowerCase()
  for (const [name, frame] of Array.from(frameByName.entries())) {
    if (name.toLowerCase() === lower) return frame
  }
  return null
}

// Wire ON_CLICK -> NAVIGATE prototype reactions from each captured link
// node to its resolved page frame. One bad link (unsupported node type,
// API rejection) is skipped so it never aborts the whole import. Returns
// how many reactions were actually set.
async function wirePrototypeLinks(
  links: Array<{ node: SceneNode; href: string }>,
  frameByName: Map<string, FrameNode>
): Promise<number> {
  let wired = 0
  for (const { node, href } of links) {
    const target = resolveTargetFrame(href, frameByName)
    if (target === null) continue
    if (!('setReactionsAsync' in node)) continue
    try {
      await (node as SceneNode & {
        setReactionsAsync: (reactions: readonly Reaction[]) => Promise<void>
      }).setReactionsAsync([
        {
          trigger: { type: 'ON_CLICK' },
          actions: [
            {
              type: 'NODE',
              destinationId: target.id,
              navigation: 'NAVIGATE',
              transition: null,
              preserveScrollPosition: false
            }
          ]
        }
      ])
      wired++
    } catch {
      // Node may not accept reactions or the API rejected the shape;
      // skip so a single link can't fail the entire import.
    }
  }
  return wired
}

export default async function (): Promise<void> {
  on<PingHandler>('PING', () => {
    emit<PongHandler>('PONG', {
      version: PLUGIN_VERSION,
      receivedAt: Date.now()
    })
  })

  on<SettingsChangedHandler>('SETTINGS_CHANGED', async (settings) => {
    try {
      await figma.clientStorage.setAsync(SETTINGS_KEY, settings)
    } catch {
      // clientStorage may be unavailable in some contexts; settings just
      // don't persist across sessions, no need to surface this.
    }
  })

  on<ImportDocumentHandler>('IMPORT_DOCUMENT', async (document) => {
    const start = Date.now()
    try {
      const result = await materializeIR(document, {
        onProgress: (stage, current, total) => {
          emit<ImportProgressHandler>('IMPORT_PROGRESS', {
            stage,
            current,
            total
          })
        }
      })
      const page = figma.currentPage
      page.appendChild(result.root)

      // Drop the root at the viewport center so it doesn't overlap with
      // existing work at the page origin.
      const center = figma.viewport.center
      result.root.x = center.x - result.root.width / 2
      result.root.y = center.y - result.root.height / 2

      page.selection = [result.root]
      figma.viewport.scrollAndZoomIntoView([result.root])

      emit<ImportCompleteHandler>('IMPORT_COMPLETE', {
        nodesCreated: result.nodesCreated,
        durationMs: Date.now() - start,
        imageFailures: document.imageFailures
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const code: 'font-load-failed' | 'figma-api-error' = message
        .toLowerCase()
        .includes('font')
        ? 'font-load-failed'
        : 'figma-api-error'
      emit<ImportErrorHandler>('IMPORT_ERROR', { code, message })
    }
  })

  on<ImportDocumentsHandler>('IMPORT_DOCUMENTS', async ({ pages, linkInteractions }) => {
    const start = Date.now()
    try {
      const figmaPage = figma.currentPage
      const created: FrameNode[] = []
      let totalNodes = 0
      const failures: IRImageFailure[] = []
      const pageCount = pages.length
      let cumulativeX = 0
      // Collected across all pages so frame-to-frame links can be wired
      // only after every target frame exists.
      const allLinks: Array<{ node: SceneNode; href: string }> = []
      const frameByName = new Map<string, FrameNode>()

      for (let i = 0; i < pageCount; i++) {
        const { name, doc } = pages[i]
        const result = await materializeIR(doc, {
          onProgress: (stage, current, total) => {
            emit<ImportProgressHandler>('IMPORT_PROGRESS', {
              stage,
              current,
              total,
              pageIndex: i,
              pageCount,
              pageName: name
            })
          }
        })
        figmaPage.appendChild(result.root)
        result.root.name = name
        result.root.x = cumulativeX
        result.root.y = 0
        cumulativeX += result.root.width + MULTI_PAGE_GAP

        created.push(result.root)
        frameByName.set(name, result.root)
        for (const link of result.linkNodes) allLinks.push(link)
        totalNodes += result.nodesCreated
        failures.push(...doc.imageFailures)
      }

      // Recenter the whole row at the viewport center as a group, so
      // the storyboard sits where the user is looking instead of at
      // page origin.
      if (created.length > 0) {
        const totalWidth = cumulativeX - MULTI_PAGE_GAP
        const tallest = Math.max(...created.map((f) => f.height))
        const center = figma.viewport.center
        const originX = center.x - totalWidth / 2
        const originY = center.y - tallest / 2
        for (const frame of created) {
          frame.x = frame.x + originX
          frame.y = frame.y + originY
        }
        figmaPage.selection = created
        figma.viewport.scrollAndZoomIntoView(created)
      }

      // Wire prototype navigation once every page frame exists. Opt-in via
      // the UI checkbox; only meaningful across multiple pages.
      let linksWired = 0
      if (linkInteractions && created.length > 0) {
        linksWired = await wirePrototypeLinks(allLinks, frameByName)
        // Set the index/first page as the prototype entry point so Present
        // mode starts somewhere sensible - but only if the page has no
        // flow yet, so we never clobber the user's existing prototype.
        if (linksWired > 0 && figmaPage.flowStartingPoints.length === 0) {
          const startFrame = frameByName.get('index.html') ?? created[0]
          figmaPage.flowStartingPoints = [
            { nodeId: startFrame.id, name: 'Flow 1' }
          ]
        }
      }

      emit<ImportCompleteHandler>('IMPORT_COMPLETE', {
        nodesCreated: totalNodes,
        durationMs: Date.now() - start,
        imageFailures: failures,
        linksWired
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const code: 'font-load-failed' | 'figma-api-error' = message
        .toLowerCase()
        .includes('font')
        ? 'font-load-failed'
        : 'figma-api-error'
      emit<ImportErrorHandler>('IMPORT_ERROR', { code, message })
    }
  })

  // Load persisted settings before showing the UI so the initial render
  // already reflects the user's last viewport choice.
  let settings = DEFAULT_SETTINGS
  try {
    const stored = await figma.clientStorage.getAsync(SETTINGS_KEY)
    if (
      stored &&
      typeof stored === 'object' &&
      typeof (stored as PluginSettings).viewportWidth === 'number'
    ) {
      settings = stored as PluginSettings
    }
  } catch {
    // Fall back to defaults.
  }

  showUI({ width: 480, height: 760 })

  // Wait a microtask so the UI's on() handler is registered before we emit.
  // create-figma-plugin's emit/on already buffers, so this is defensive.
  emit<SettingsLoadedHandler>('SETTINGS_LOADED', settings)
}
