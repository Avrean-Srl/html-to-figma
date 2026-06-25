import { describe, expect, it } from 'vitest'

import { materializeIR } from '../../src/mapper'
import { parseHtmlToIR } from '../../src/parser'

// Regression for the "object is not extensible" figma-api-error seen
// importing real-world mockups (deltatre.zip). A dotted-background overlay
// shipped as an inline SVG <pattern> referenced via fill="url(#id)" makes
// Figma reject the markup with a raw "object is not extensible" TypeError.
// The throw can surface two ways, and BOTH must be survived:
//   (a) createNodeFromSvg itself throws, or
//   (b) it returns a node whose frozen `fills` setter throws when we touch it.
// createSvgFromIR wraps the whole import and falls back to a placeholder
// frame, so one decorative icon never aborts the multi-page import.

function makeNode(type: string): Record<string, unknown> {
  const node: Record<string, unknown> = {
    type,
    name: '',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    opacity: 1,
    characters: '',
    fills: [] as unknown[],
    children: [] as unknown[],
    parent: null,
    resize(w: number, h: number) {
      node.width = w
      node.height = h
    },
    appendChild(child: Record<string, unknown>) {
      ;(node.children as unknown[]).push(child)
      child.parent = node
    },
    remove() {},
    setRangeFontName() {},
    setRangeFills() {},
    setRangeTextDecoration() {}
  }
  return node
}

// A node whose `fills` setter throws "object is not extensible", exactly how
// Figma's SVG importer surfaces an unrepresentable <pattern> fill AFTER
// successfully returning the frame from createNodeFromSvg.
function makeFrozenFillsNode(): Record<string, unknown> {
  const node = makeNode('FRAME')
  Object.defineProperty(node, 'fills', {
    configurable: true,
    enumerable: true,
    get() {
      return []
    },
    set() {
      throw new TypeError('object is not extensible')
    }
  })
  return node
}

type SvgMode = 'throw-on-parse' | 'throw-on-fills'

function installFigma(mode: SvgMode): { svgRejections: number } {
  const stats = { svgRejections: 0 }
  const isPattern = (svg: string): boolean =>
    /<pattern\b/i.test(svg) || /fill\s*=\s*["']url\(#/i.test(svg)
  ;(globalThis as unknown as { figma: unknown }).figma = {
    createFrame: () => makeNode('FRAME'),
    createText: () => makeNode('TEXT'),
    createRectangle: () => makeNode('RECTANGLE'),
    createNodeFromSvg: (svg: string) => {
      if (isPattern(svg)) {
        stats.svgRejections++
        if (mode === 'throw-on-parse') {
          throw new TypeError('object is not extensible')
        }
        return makeFrozenFillsNode()
      }
      return makeNode('FRAME')
    },
    loadFontAsync: async () => {},
    listAvailableFontsAsync: async () => [
      { fontName: { family: 'Inter', style: 'Regular' } }
    ],
    currentPage: { appendChild: () => {}, selection: [] },
    viewport: { center: { x: 0, y: 0 }, scrollAndZoomIntoView: () => {} }
  }
  return stats
}

// Mirrors deltatre's `.dots` overlay: an SVG pattern fill Figma can't import.
const HTML = `<!doctype html><html><head><style>
  *{box-sizing:border-box;margin:0}
  .pane{position:relative;width:400px;height:300px}
  .dots{position:absolute;inset:0;width:100%;height:100%}
</style></head><body>
  <div class="pane">
    <svg class="dots" xmlns="http://www.w3.org/2000/svg">
      <defs><pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r="1.6" fill="#fff"/></pattern></defs>
      <rect width="100%" height="100%" fill="url(#dots)"/>
    </svg>
  </div>
</body></html>`

describe('SVG pattern-fill fallback', () => {
  it('survives createNodeFromSvg throwing on a pattern fill', async () => {
    const stats = installFigma('throw-on-parse')
    const ir = await parseHtmlToIR(HTML, { viewportWidth: 1440 })
    await expect(materializeIR(ir)).resolves.toBeDefined()
    expect(stats.svgRejections).toBeGreaterThan(0)
  })

  it('survives a returned SVG node whose fills setter is not extensible', async () => {
    const stats = installFigma('throw-on-fills')
    const ir = await parseHtmlToIR(HTML, { viewportWidth: 1440 })
    await expect(materializeIR(ir)).resolves.toBeDefined()
    expect(stats.svgRejections).toBeGreaterThan(0)
  })
})
