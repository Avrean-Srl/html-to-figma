import type { IRDocument, IRFrame } from '../types/ir'

export interface ParseOptions {
  viewportWidth: number
}

// Phase 1.1 stub. Returns an empty IRDocument with a single root frame
// sized to the requested viewport. Real DOM rendering + walker + style
// extraction arrives in Phase 1.2.
export async function parseHtmlToIR(
  _html: string,
  options: ParseOptions
): Promise<IRDocument> {
  const root: IRFrame = {
    type: 'frame',
    id: 'root',
    layout: { x: 0, y: 0, width: options.viewportWidth, height: 0 },
    opacity: 1,
    hidden: false,
    sourceTag: 'body',
    fills: [],
    cornerRadius: [0, 0, 0, 0],
    children: [],
    autoLayout: null
  }

  return {
    viewportWidth: options.viewportWidth,
    root,
    fontsUsed: [],
    imageFailures: []
  }
}
