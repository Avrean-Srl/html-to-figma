import { afterEach, describe, expect, it } from 'vitest'

import { walkDocument } from '../../src/parser/walker'

const mounted: HTMLElement[] = []

function setup(html: string, viewportWidth = 1440): HTMLElement {
  const container = document.createElement('div')
  container.style.cssText = `position: absolute; left: -99999px; top: 0; width: ${viewportWidth}px;`
  container.innerHTML = html
  document.body.appendChild(container)
  mounted.push(container)
  return container
}

afterEach(() => {
  while (mounted.length > 0) {
    const el = mounted.pop()
    el?.remove()
  }
})

describe('walkDocument inlines computed SVG presentation attributes', () => {
  it('writes fill from an external CSS rule onto a <rect> element', () => {
    // Mirrors the boero dashboard pattern:
    //   .chart .bar { fill: rgb(186, 33, 37) }
    //   <svg class="chart"><rect class="bar" .../></svg>
    // Without the inliner, the captured SVG markup has no inline fill
    // on the rect, and Figma defaults it to solid black.
    const container = setup(`
      <style>
        .chart .bar { fill: rgb(186, 33, 37); }
      </style>
      <svg class="chart" viewBox="0 0 100 100" width="100" height="100">
        <rect class="bar" x="10" y="10" width="20" height="80"/>
      </svg>
    `)
    const result = walkDocument(container, 1440)
    const svg = result.root.children[0]
    expect(svg.type).toBe('svg')
    if (svg.type === 'svg') {
      expect(svg.svg).toMatch(/<rect[^>]*\bfill="rgb\(186,\s*33,\s*37\)"/)
    }
  })

  it('writes stroke + stroke-width from CSS onto an SVG <line>', () => {
    const container = setup(`
      <style>
        .grid-line { stroke: rgb(220, 220, 220); stroke-width: 2; }
      </style>
      <svg viewBox="0 0 100 50" width="100" height="50">
        <line class="grid-line" x1="0" y1="25" x2="100" y2="25"/>
      </svg>
    `)
    const result = walkDocument(container, 1440)
    const svg = result.root.children[0]
    if (svg.type === 'svg') {
      expect(svg.svg).toMatch(/<line[^>]*\bstroke="rgb\(220,\s*220,\s*220\)"/)
      // Browsers normalize stroke-width to a px value in computed style;
      // either "2" or "2px" is semantically equivalent.
      expect(svg.svg).toMatch(/<line[^>]*\bstroke-width="2(px)?"/)
    }
  })

  it('writes font-family + font-size onto an SVG <text> so glyphs use the page font', () => {
    // Without inlining font properties on SVG text, Figma's SVG
    // importer falls back to a default monospace and the glyph paths
    // it generates are wider, so "GIU" can wrap to "G I U".
    const container = setup(`
      <style>
        .chart text { font-family: 'Geist Mono', monospace; font-size: 10px; }
      </style>
      <svg class="chart" viewBox="0 0 100 30" width="100" height="30">
        <text x="10" y="20">GIU</text>
      </svg>
    `)
    const result = walkDocument(container, 1440)
    const svg = result.root.children[0]
    if (svg.type === 'svg') {
      // The browser computes font-family with quoting variations - any
      // mention of Geist Mono is fine.
      expect(svg.svg).toMatch(/<text[^>]*\bfont-family="[^"]*Geist Mono/i)
      expect(svg.svg).toMatch(/<text[^>]*\bfont-size="10px"/)
    }
  })

  it('does not mutate the original SVG element in the live document', () => {
    // We work on a clone, so the rendered DOM should keep its
    // attribute shape (so consecutive walker passes are deterministic).
    const container = setup(`
      <style> .b { fill: rgb(0, 200, 0); } </style>
      <svg viewBox="0 0 10 10" width="10" height="10">
        <rect class="b" x="0" y="0" width="10" height="10"/>
      </svg>
    `)
    walkDocument(container, 1440)
    const rect = container.querySelector('svg rect')!
    // Original element still has no inline fill - the inliner wrote
    // onto the clone only.
    expect(rect.getAttribute('fill')).toBeNull()
  })

  it('preserves existing inline fill="none" on icon strokes', () => {
    // Stroke-only icons use `fill="none"` to avoid a filled silhouette.
    // The browser reports computed fill as 'none', which we just write
    // back (no-op semantically).
    const container = setup(`
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="rgb(20, 20, 20)" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
      </svg>
    `)
    const result = walkDocument(container, 1440)
    const svg = result.root.children[0]
    if (svg.type === 'svg') {
      expect(svg.svg).toMatch(/fill="none"/)
      expect(svg.svg).toMatch(/<circle[^>]*\bstroke="rgb\(20,\s*20,\s*20\)"/)
    }
  })

  it('still inlines styles when the SVG lives inside an iframe document', async () => {
    // Regression test for the production bug where the inliner silently
    // no-oped: `el instanceof SVGElement` is FALSE when `el` belongs to
    // an iframe's contentWindow (different constructor than the parent's
    // window.SVGElement). The render harness uses a real iframe, so
    // every production SVG flowed through that exact path. Switching
    // to a namespaceURI string check fixes it.
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position: fixed; left: -99999px; width: 1440px; height: 900px;'
    const loaded = new Promise<void>((resolve) => {
      iframe.addEventListener('load', () => resolve(), { once: true })
    })
    iframe.srcdoc = `
      <style> .chart .bar { fill: rgb(186, 33, 37); } </style>
      <svg class="chart" viewBox="0 0 100 100" width="100" height="100">
        <rect class="bar" x="10" y="10" width="20" height="80"/>
      </svg>
    `
    document.body.appendChild(iframe)
    try {
      await loaded
      const body = iframe.contentDocument!.body
      const result = walkDocument(body, 1440)
      // root children include style ignored + svg
      const svg = result.root.children.find((c) => c.type === 'svg')
      expect(svg).toBeDefined()
      if (svg && svg.type === 'svg') {
        // The whole point: the rect's fill must be inlined even when
        // the source element lives in another window.
        expect(svg.svg).toMatch(/<rect[^>]*\bfill="rgb\(186,\s*33,\s*37\)"/)
      }
    } finally {
      iframe.remove()
    }
  })
})
