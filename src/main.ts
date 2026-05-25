import { emit, on, showUI } from '@create-figma-plugin/utilities'

import { materializeIR } from './mapper'
import type {
  ImportCompleteHandler,
  ImportDocumentHandler,
  ImportErrorHandler,
  PingHandler,
  PongHandler
} from './types/messages'

const PLUGIN_VERSION = '0.1.0'

export default function (): void {
  on<PingHandler>('PING', () => {
    emit<PongHandler>('PONG', {
      version: PLUGIN_VERSION,
      receivedAt: Date.now()
    })
  })

  on<ImportDocumentHandler>('IMPORT_DOCUMENT', async (document) => {
    const start = Date.now()
    try {
      const result = await materializeIR(document)
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

  showUI({ width: 480, height: 640 })
}
