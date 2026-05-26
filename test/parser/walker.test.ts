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

describe('walkDocument', () => {
  it('returns a root frame sized to the viewport', () => {
    const container = setup('<div>x</div>')
    const result = walkDocument(container, 1440)

    expect(result.root.type).toBe('frame')
    expect(result.root.sourceTag).toBe('body')
    expect(result.root.layout.width).toBe(1440)
  })

  it('walks a leaf div with text into an IRText child', () => {
    const container = setup('<div>Hello</div>')
    const result = walkDocument(container, 1440)

    expect(result.root.children).toHaveLength(1)
    const child = result.root.children[0]
    expect(child.type).toBe('text')
    if (child.type === 'text') {
      expect(child.characters).toBe('Hello')
    }
  })

  it('walks nested element children into nested IRFrames', () => {
    const container = setup('<div><p>A</p><p>B</p></div>')
    const result = walkDocument(container, 1440)

    expect(result.root.children).toHaveLength(1)
    const outer = result.root.children[0]
    expect(outer.type).toBe('frame')
    if (outer.type === 'frame') {
      expect(outer.children).toHaveLength(2)
      expect(outer.children[0].type).toBe('text')
      expect(outer.children[1].type).toBe('text')
    }
  })

  it('skips elements with display: none', () => {
    const container = setup(
      '<div>Visible</div><div style="display:none">Hidden</div>'
    )
    const result = walkDocument(container, 1440)

    expect(result.root.children).toHaveLength(1)
  })

  it('skips script and style elements entirely', () => {
    const container = setup(
      '<div>Keep</div><script>1</script><style>.x { color: red }</style>'
    )
    const result = walkDocument(container, 1440)

    expect(result.root.children).toHaveLength(1)
    const child = result.root.children[0]
    expect(child.type).toBe('text')
  })

  it('captures <img> as IRImage with sourceUrl and pending status for remote URLs', () => {
    const container = setup(
      '<img src="https://example.com/foo.jpg" width="200" height="100" />'
    )
    const result = walkDocument(container, 1440)

    expect(result.root.children).toHaveLength(1)
    const child = result.root.children[0]
    expect(child.type).toBe('image')
    if (child.type === 'image') {
      expect(child.sourceUrl).toBe('https://example.com/foo.jpg')
      expect(child.loadStatus).toBe('pending')
      expect(child.bytes).toBeNull()
    }
  })

  it('marks data URL images as data-url status', () => {
    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    const container = setup(`<img src="${tinyPng}" width="10" height="10" />`)
    const result = walkDocument(container, 1440)

    const child = result.root.children[0]
    expect(child.type).toBe('image')
    if (child.type === 'image') {
      expect(child.loadStatus).toBe('data-url')
    }
  })

  it('captures <svg> as IRSvg with raw markup', () => {
    const container = setup(
      '<svg width="100" height="50" viewBox="0 0 100 50"><circle cx="50" cy="25" r="20" fill="red"/></svg>'
    )
    const result = walkDocument(container, 1440)

    const child = result.root.children[0]
    expect(child.type).toBe('svg')
    if (child.type === 'svg') {
      expect(child.svg).toContain('<svg')
      expect(child.svg).toContain('<circle')
    }
  })

  it('extracts background color as solid fill in 0-1 space', () => {
    const container = setup(
      '<div style="background: rgb(255, 0, 0); width: 100px; height: 50px"></div>'
    )
    const result = walkDocument(container, 1440)

    const frame = result.root.children[0]
    expect(frame.type).toBe('frame')
    if (frame.type === 'frame') {
      expect(frame.fills).toHaveLength(1)
      expect(frame.fills[0].color.r).toBe(1)
      expect(frame.fills[0].color.g).toBe(0)
      expect(frame.fills[0].color.b).toBe(0)
    }
  })

  it('collects unique fonts used in fontsUsed (dedup by family+weight+style)', () => {
    const container = setup(`
      <div style="font-family: Inter; font-weight: 400">A</div>
      <div style="font-family: Inter; font-weight: 700">B</div>
      <div style="font-family: Inter; font-weight: 400">C</div>
    `)
    const result = walkDocument(container, 1440)

    expect(result.fontsUsed.length).toBeGreaterThanOrEqual(2)
    const keys = result.fontsUsed.map((f) => `${f.family}|${f.weight}|${f.style}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('wraps a styled text-leaf in IRFrame containing IRText (background, padding, radius)', () => {
    const container = setup(
      '<div style="background: rgb(0, 128, 255); padding: 20px; border-radius: 8px">Boxed</div>'
    )
    const result = walkDocument(container, 1440)

    expect(result.root.children).toHaveLength(1)
    const wrapper = result.root.children[0]
    expect(wrapper.type).toBe('frame')
    if (wrapper.type === 'frame') {
      expect(wrapper.fills).toHaveLength(1)
      expect(wrapper.cornerRadius).toEqual([8, 8, 8, 8])
      expect(wrapper.children).toHaveLength(1)
      expect(wrapper.children[0].type).toBe('text')
      if (wrapper.children[0].type === 'text') {
        expect(wrapper.children[0].characters).toBe('Boxed')
      }
    }
  })

  it('keeps a plain text-leaf as IRText (no frame wrapping)', () => {
    const container = setup('<div>plain</div>')
    const result = walkDocument(container, 1440)

    expect(result.root.children).toHaveLength(1)
    expect(result.root.children[0].type).toBe('text')
  })

  it('merges <p>Hello <strong>world</strong></p> into one IRText with a bold range', () => {
    // Inline-phrase merge: instead of fragmenting into separate texts
    // for "Hello " and "world", we now keep the whole paragraph as ONE
    // editable text layer with a character-range marking "world" bold.
    const container = setup('<p>Hello <strong>world</strong></p>')
    const result = walkDocument(container, 1440)

    const para = result.root.children[0]
    expect(para.type).toBe('frame')
    if (para.type === 'frame') {
      const texts = para.children.filter((c) => c.type === 'text')
      expect(texts).toHaveLength(1)
      if (texts[0].type === 'text') {
        expect(texts[0].characters).toBe('Hello world')
        const ranges = texts[0].ranges ?? []
        const bold = ranges.find((r) => (r.fontWeight ?? 400) >= 600)
        expect(bold).toBeDefined()
        if (bold) {
          expect(texts[0].characters.slice(bold.start, bold.end)).toBe('world')
        }
      }
    }
  })
})
