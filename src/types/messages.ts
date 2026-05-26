import type { EventHandler } from '@create-figma-plugin/utilities'

import type { IRDocument, IRImageFailure } from './ir'

// UI -> main: connectivity check fired on UI mount. Phase 0 sanity.
export interface PingHandler extends EventHandler {
  name: 'PING'
  handler: () => void
}

// main -> UI: response to PING with build info.
export interface PongHandler extends EventHandler {
  name: 'PONG'
  handler: (data: PongPayload) => void
}

export interface PongPayload {
  version: string
  receivedAt: number
}

// UI -> main: parsed IR ready to be materialized into Figma nodes. Phase 1+.
export interface ImportDocumentHandler extends EventHandler {
  name: 'IMPORT_DOCUMENT'
  handler: (document: IRDocument) => void
}

// UI -> main: a batch of parsed IRs (one per HTML page in a multi-page
// ZIP). Main lays them out as side-by-side frames so the user gets the
// whole mockup in one shot.
export interface ImportDocumentsHandler extends EventHandler {
  name: 'IMPORT_DOCUMENTS'
  handler: (payload: ImportDocumentsPayload) => void
}

export interface ImportDocumentsPayload {
  pages: Array<{ name: string; doc: IRDocument }>
}

// main -> UI: progress update during materialization. Phase 5+ for large docs.
export interface ImportProgressHandler extends EventHandler {
  name: 'IMPORT_PROGRESS'
  handler: (data: ImportProgress) => void
}

export interface ImportProgress {
  stage: 'fonts' | 'nodes' | 'images' | 'effects' | 'done' | 'parsing'
  current: number
  total: number
  // Set during a multi-page ZIP import so the UI can show "Page 3/13".
  pageIndex?: number
  pageCount?: number
  pageName?: string
}

// main -> UI: import finished, summary for the post-import report. Phase 1+.
export interface ImportCompleteHandler extends EventHandler {
  name: 'IMPORT_COMPLETE'
  handler: (summary: ImportSummary) => void
}

export interface ImportSummary {
  nodesCreated: number
  durationMs: number
  imageFailures: IRImageFailure[]
}

// main -> UI: unrecoverable error during import.
export interface ImportErrorHandler extends EventHandler {
  name: 'IMPORT_ERROR'
  handler: (error: ImportError) => void
}

export interface ImportError {
  code:
    | 'invalid-ir'
    | 'font-load-failed'
    | 'figma-api-error'
    | 'unknown'
  message: string
}

// main -> UI: persisted plugin settings loaded on plugin start.
export interface SettingsLoadedHandler extends EventHandler {
  name: 'SETTINGS_LOADED'
  handler: (settings: PluginSettings) => void
}

// UI -> main: user changed a setting that should persist across sessions.
export interface SettingsChangedHandler extends EventHandler {
  name: 'SETTINGS_CHANGED'
  handler: (settings: PluginSettings) => void
}

export interface PluginSettings {
  viewportWidth: number
}
