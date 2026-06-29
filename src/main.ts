import { emit, on, showUI } from '@create-figma-plugin/utilities'

import { materializeIR } from './mapper'
import { planSections } from './mapper/sections'
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

const PLUGIN_VERSION = '0.3.4'
const SETTINGS_KEY = 'plugin-settings-v1'
const DEFAULT_SETTINGS: PluginSettings = {
  viewportWidth: 1440,
  linkInteractions: false
}
// Horizontal gutter between multi-page frames so they read as a
// storyboard, not a tile sheet. 100 px reads cleanly at 50% zoom.
const MULTI_PAGE_GAP = 100

// Sectioned layout constants (match the hand-built "V1" page): inner
// padding around the frames, horizontal gap between frames in a row, and
// vertical gap between stacked sections.
const SECTION_PAD = 120
const SECTION_FRAME_GAP = 120
const SECTION_VGAP = 240

// Groups the imported page frames into Figma sections by filename prefix,
// each section a horizontal row, sections stacked vertically. Returns the
// created section nodes (the new top-level nodes to select / recenter).
function layoutIntoSections(
  page: PageNode,
  built: ReadonlyArray<{ name: string; frame: FrameNode }>
): SectionNode[] {
  const plan = planSections(built)
  const sections: SectionNode[] = []
  let cumulativeY = 0

  for (const group of plan) {
    const section = figma.createSection()
    section.name = group.key
    page.appendChild(section)

    let localX = SECTION_PAD
    let maxH = 0
    for (const { frame } of group.items) {
      section.appendChild(frame)
      // Section children use section-relative coordinates.
      frame.x = localX
      frame.y = SECTION_PAD
      localX += frame.width + SECTION_FRAME_GAP
      if (frame.height > maxH) maxH = frame.height
    }

    const sectionW = localX - SECTION_FRAME_GAP + SECTION_PAD
    const sectionH = maxH + SECTION_PAD * 2
    section.resizeWithoutConstraints(
      Math.max(sectionW, 1),
      Math.max(sectionH, 1)
    )
    section.x = 0
    section.y = cumulativeY
    cumulativeY += sectionH + SECTION_VGAP
    sections.push(section)
  }
  return sections
}

// Recenters a set of top-level page nodes (frames or sections) around the
// viewport center as a group.
function recenterAtViewport(nodes: ReadonlyArray<SceneNode>): void {
  if (nodes.length === 0) return
  const minX = Math.min(...nodes.map((n) => n.x))
  const minY = Math.min(...nodes.map((n) => n.y))
  const maxX = Math.max(...nodes.map((n) => n.x + n.width))
  const maxY = Math.max(...nodes.map((n) => n.y + n.height))
  const center = figma.viewport.center
  const dx = center.x - (minX + maxX) / 2
  const dy = center.y - (minY + maxY) / 2
  for (const n of nodes) {
    n.x += dx
    n.y += dy
  }
}

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
    // Typed as Reaction[] so the literals below are contextually typed:
    // without the annotation TS widens 'ON_CLICK' / 'NODE' / 'NAVIGATE' to
    // plain `string` and they stop matching the Trigger / Action / Navigation
    // unions ("Type 'string' is not assignable to type 'Navigation'").
    const reactions: Reaction[] = [
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
    ]
    try {
      await (node as SceneNode & ReactionMixin).setReactionsAsync(reactions)
      wired++
    } catch {
      // Node may not accept reactions or the API rejected the shape;
      // skip so a single link can't fail the entire import.
    }
  }
  return wired
}

export default async function (): Promise<void> {
  // Load persisted settings up front so the PING handler can answer with
  // hydrated values the moment the UI announces it is ready.
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

  on<PingHandler>('PING', () => {
    emit<PongHandler>('PONG', {
      version: PLUGIN_VERSION,
      receivedAt: Date.now()
    })
    // The UI sends PING from its mount effect, AFTER registering every on()
    // handler (including SETTINGS_LOADED). Pushing settings here - rather
    // than eagerly right after showUI() - avoids the startup race where the
    // message arrived first and create-figma-plugin threw "No event handler
    // with name SETTINGS_LOADED", spamming the console on every launch.
    emit<SettingsLoadedHandler>('SETTINGS_LOADED', settings)
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

  on<ImportDocumentsHandler>('IMPORT_DOCUMENTS', async ({ pages, linkInteractions, groupSections }) => {
    const start = Date.now()
    try {
      const figmaPage = figma.currentPage
      const created: FrameNode[] = []
      const built: Array<{ name: string; frame: FrameNode }> = []
      let totalNodes = 0
      const failures: IRImageFailure[] = []
      const pageCount = pages.length
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

        created.push(result.root)
        built.push({ name, frame: result.root })
        frameByName.set(name, result.root)
        for (const link of result.linkNodes) allLinks.push(link)
        totalNodes += result.nodesCreated
        failures.push(...doc.imageFailures)
      }

      // Arrange the imported frames: grouped into sections by filename
      // prefix, or as a single horizontal storyboard row. Either way the
      // resulting top-level nodes are recentered at the viewport.
      if (built.length > 0) {
        let topLevel: SceneNode[]
        if (groupSections) {
          topLevel = layoutIntoSections(figmaPage, built)
        } else {
          let cumulativeX = 0
          for (const { frame } of built) {
            frame.x = cumulativeX
            frame.y = 0
            cumulativeX += frame.width + MULTI_PAGE_GAP
          }
          topLevel = created
        }
        recenterAtViewport(topLevel)
        figmaPage.selection = topLevel
        figma.viewport.scrollAndZoomIntoView(topLevel)
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

  showUI({ width: 480, height: 760 })
}
