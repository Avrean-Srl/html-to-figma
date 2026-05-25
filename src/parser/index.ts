import type { IRDocument } from '../types/ir'

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
    return {
      viewportWidth: options.viewportWidth,
      root: walked.root,
      fontsUsed: walked.fontsUsed,
      imageFailures: walked.imageFailures
    }
  } finally {
    handle.cleanup()
  }
}
