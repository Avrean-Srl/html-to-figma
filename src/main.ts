import { emit, on, showUI } from '@create-figma-plugin/utilities'

import { materializeIR } from './mapper'
import type {
  ImportCompleteHandler,
  ImportDocumentHandler,
  ImportErrorHandler,
  ImportProgressHandler,
  PingHandler,
  PongHandler,
  PluginSettings,
  SettingsChangedHandler,
  SettingsLoadedHandler
} from './types/messages'

const PLUGIN_VERSION = '0.1.0'
const SETTINGS_KEY = 'plugin-settings-v1'
const DEFAULT_SETTINGS: PluginSettings = { viewportWidth: 1440 }

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

  showUI({ width: 480, height: 680 })

  // Wait a microtask so the UI's on() handler is registered before we emit.
  // create-figma-plugin's emit/on already buffers, so this is defensive.
  emit<SettingsLoadedHandler>('SETTINGS_LOADED', settings)
}
