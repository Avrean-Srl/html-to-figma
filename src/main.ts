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

const PLUGIN_VERSION = '0.2.9'
const SETTINGS_KEY = 'plugin-settings-v1'
const DEFAULT_SETTINGS: PluginSettings = { viewportWidth: 1440 }
// Horizontal gutter between multi-page frames so they read as a
// storyboard, not a tile sheet. 100 px reads cleanly at 50% zoom.
const MULTI_PAGE_GAP = 100

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

  on<ImportDocumentsHandler>('IMPORT_DOCUMENTS', async ({ pages }) => {
    const start = Date.now()
    try {
      const figmaPage = figma.currentPage
      const created: FrameNode[] = []
      let totalNodes = 0
      const failures: IRImageFailure[] = []
      const pageCount = pages.length
      let cumulativeX = 0

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

      emit<ImportCompleteHandler>('IMPORT_COMPLETE', {
        nodesCreated: totalNodes,
        durationMs: Date.now() - start,
        imageFailures: failures
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
