import { describe, expect, it } from 'vitest'

import { parseHtmlToIR } from '../../src/parser'

describe('parseHtmlToIR', () => {
  it('parses a simple div with text into an IRDocument', async () => {
    const ir = await parseHtmlToIR('<div>Hello</div>', { viewportWidth: 1440 })

    expect(ir.viewportWidth).toBe(1440)
    expect(ir.root.type).toBe('frame')
    expect(ir.root.children.length).toBeGreaterThanOrEqual(1)
    const flat = flatten(ir.root.children)
    const helloText = flat.find(
      (n) => n.type === 'text' && n.characters === 'Hello'
    )
    expect(helloText).toBeDefined()
  })

  it('respects viewport width in the root frame layout', async () => {
    const ir = await parseHtmlToIR('<div>x</div>', { viewportWidth: 768 })
    expect(ir.root.layout.width).toBe(768)
  })

  it('returns empty children for whitespace-only HTML', async () => {
    const ir = await parseHtmlToIR('   \n   ', { viewportWidth: 1440 })
    expect(ir.root.children).toEqual([])
  })

  it('collects fonts used at least for the parsed text', async () => {
    const ir = await parseHtmlToIR(
      '<div style="font-family: Arial">Hi</div>',
      { viewportWidth: 1440 }
    )
    expect(ir.fontsUsed.length).toBeGreaterThan(0)
  })

  it('decodes data URL images to bytes during loadImages pass', async () => {
    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    const ir = await parseHtmlToIR(
      `<img src="${tinyPng}" width="10" height="10" />`,
      { viewportWidth: 1440 }
    )
    const flat = flatten(ir.root.children)
    const img = flat.find((n) => n.type === 'image')
    expect(img).toBeDefined()
    if (img?.type === 'image') {
      expect(img.loadStatus).toBe('data-url')
      expect(img.bytes).not.toBeNull()
      expect(img.bytes!.length).toBeGreaterThan(0)
    }
    expect(ir.imageFailures).toEqual([])
  })
})

function flatten(nodes: ReadonlyArray<import('../../src/types/ir').IRNode>): import('../../src/types/ir').IRNode[] {
  const out: import('../../src/types/ir').IRNode[] = []
  for (const n of nodes) {
    out.push(n)
    if (n.type === 'frame') out.push(...flatten(n.children))
  }
  return out
}
