import { describe, expect, it } from 'vitest'

import { parseHtmlToIR } from '../../src/parser'
import type { IRNode } from '../../src/types/ir'

// Regression: an absolutely-positioned decorative SVG (or <img>) inside a
// flex container was walked as an IN-FLOW child because buildSvg/buildImage
// never read CSS `position`. In a `justify-content: space-between` column it
// then occupied a full-height row, so the real content had no free space and
// Figma collapsed it into overlapping layers. This is the deltatre login
// brandpane: a full-bleed `.dots` overlay (`position:absolute; inset:0`)
// sitting next to the watermark / title / footer.

function find(node: IRNode, pred: (n: IRNode) => boolean): IRNode | null {
  if (pred(node)) return node
  if (node.type === 'frame') {
    for (const c of node.children) {
      const hit = find(c, pred)
      if (hit) return hit
    }
  }
  return null
}

describe('absolute SVG / image stay out of flex flow', () => {
  it('marks an inset:0 absolute SVG as positioning=absolute + stretch', async () => {
    const html = `<!doctype html><html><head><style>
      *{box-sizing:border-box;margin:0}
      .pane{position:relative;display:flex;flex-direction:column;
        justify-content:space-between;width:480px;height:600px;padding:40px}
      .dots{position:absolute;inset:0;width:100%;height:100%}
      .top,.mid,.bot{height:40px}
    </style></head><body>
      <div class="pane">
        <svg class="dots" xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>
        <div class="top">top</div>
        <div class="mid">mid</div>
        <div class="bot">bot</div>
      </div>
    </body></html>`
    const ir = await parseHtmlToIR(html, { viewportWidth: 1440 })

    const pane = find(
      ir.root,
      (n) =>
        n.type === 'frame' &&
        n.autoLayout?.direction === 'vertical' &&
        n.autoLayout?.primaryAxisAlign === 'space-between'
    )
    expect(pane).not.toBeNull()
    if (pane?.type !== 'frame') return

    const svg = pane.children.find((c) => c.type === 'svg')
    expect(svg).toBeDefined()
    // The decorative overlay must be out of flow so it doesn't consume a
    // row of the space-between column.
    expect(svg?.positioning).toBe('absolute')
    expect(svg?.constraintsStretch).toEqual({ horizontal: true, vertical: true })

    // The three real children remain in flow (so space-between spreads them).
    const inFlow = pane.children.filter((c) => c.positioning !== 'absolute')
    expect(inFlow).toHaveLength(3)
  })

  it('marks an absolute <img> as positioning=absolute', async () => {
    const html = `<!doctype html><html><head><style>
      *{box-sizing:border-box;margin:0}
      .hero{position:relative;display:flex;width:600px;height:300px}
      .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
    </style></head><body>
      <div class="hero">
        <img class="bg" src="data:image/png;base64,iVBORw0KGgo=" alt="">
        <div style="width:120px;height:40px">content</div>
      </div>
    </body></html>`
    const ir = await parseHtmlToIR(html, { viewportWidth: 1440 })
    const img = find(ir.root, (n) => n.type === 'image')
    expect(img).not.toBeNull()
    expect(img?.positioning).toBe('absolute')
  })

  it('leaves an in-flow SVG as positioning=auto', async () => {
    const html = `<!doctype html><html><head><style>
      *{box-sizing:border-box;margin:0}
      .row{display:flex;gap:8px;width:300px}
      .ic{width:24px;height:24px}
    </style></head><body>
      <div class="row">
        <svg class="ic" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24"/></svg>
        <div style="width:100px;height:24px">label</div>
      </div>
    </body></html>`
    const ir = await parseHtmlToIR(html, { viewportWidth: 1440 })
    const svg = find(ir.root, (n) => n.type === 'svg')
    expect(svg).not.toBeNull()
    expect(svg?.positioning ?? 'auto').toBe('auto')
  })
})
