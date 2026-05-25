import type { IRDocument } from '../types/ir'

import { loadImages } from './images'
import { renderHidden } from './render'
import { walkDocument } from './walker'

export interface ParseOptions {
  viewportWidth: number
}

export async function parseHtmlToIR(
  html: string,
  options: ParseOptions
): Promise<IRDocument> {
  const handle = await renderHidden(html, options.viewportWidth)
  try {
    const walked = walkDocument(handle.body, options.viewportWidth)
    const doc: IRDocument = {
      viewportWidth: options.viewportWidth,
      root: walked.root,
      fontsUsed: walked.fontsUsed,
      imageFailures: walked.imageFailures
    }
    // Async second pass: data URLs decode in-process, remote URLs fetch
    // with CORS handling. Doc may be returned with imageFailures populated.
    await loadImages(doc)
    return doc
  } finally {
    handle.cleanup()
  }
}
