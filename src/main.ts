import { emit, on, showUI } from '@create-figma-plugin/utilities'

import type {
  ImportCompleteHandler,
  ImportDocumentHandler,
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

  on<ImportDocumentHandler>('IMPORT_DOCUMENT', (document) => {
    // Phase 1.1 stub. Logs the payload and acks immediately. Real
    // materialization (FrameNode/TextNode creation, font batch loading,
    // image paint) arrives in Phase 1.3.
    const start = Date.now()
    console.log('[main] IMPORT_DOCUMENT received', {
      viewportWidth: document.viewportWidth,
      rootChildren: document.root.children.length,
      fontsUsed: document.fontsUsed.length,
      imageFailures: document.imageFailures.length
    })

    emit<ImportCompleteHandler>('IMPORT_COMPLETE', {
      nodesCreated: 0,
      durationMs: Date.now() - start,
      imageFailures: document.imageFailures
    })
  })

  showUI({ width: 480, height: 640 })
}
