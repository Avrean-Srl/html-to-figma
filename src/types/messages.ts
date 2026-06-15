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
  // Mirror of PluginSettings.linkInteractions at import time so the main
  // thread knows whether to wire frame-to-frame prototype reactions for
  // this run. Only multi-page imports can resolve internal nav targets.
  linkInteractions?: boolean
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
  // Number of internal nav links wired into Figma prototype reactions.
  // Present only for multi-page imports with linkInteractions enabled.
  linksWired?: number
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
  // When true, a multi-page import wires Figma prototype reactions from
  // internal nav links (<a href="other-page.html">) to the matching page
  // frame. Optional so settings persisted before this feature still load.
  linkInteractions?: boolean
}
