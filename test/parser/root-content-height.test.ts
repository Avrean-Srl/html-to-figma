import { describe, expect, it } from 'vitest'

import { parseHtmlToIR } from '../../src/parser'

// Regression: page frames came out viewport-tall and their content spilled
// out the bottom. A global `html, body { height: 100% }` pins the body box
// to the viewport, while the page's content (e.g. a `min-height: 100vh`
// shell plus more) is taller. The walker used the body's border-box height
// for the root frame, so everything below the fold overflowed the frame.
// The root must instead grow to the full content extent (scrollHeight).
describe('root frame contains its full content height', () => {
  it('sizes the root to content, not the clamped viewport height', async () => {
    const html = `<!doctype html><html><head><style>
      *{box-sizing:border-box;margin:0}
      html,body{height:100%}
      .app{min-height:100vh;width:100%}
      .block{height:1600px;background:#eee}
    </style></head><body>
      <div class="app"><div class="block"></div></div>
    </body></html>`
    const ir = await parseHtmlToIR(html, { viewportWidth: 1440 })

    // The content is ~1600px tall - far beyond any clamped viewport height.
    expect(ir.root.layout.height).toBeGreaterThanOrEqual(1600)

    // And the root must be at least as tall as its tallest child's bottom,
    // so nothing overflows the page frame.
    const maxChildBottom = Math.max(
      ...ir.root.children.map((c) => c.layout.y + c.layout.height)
    )
    expect(ir.root.layout.height).toBeGreaterThanOrEqual(maxChildBottom - 1)
  })
})
