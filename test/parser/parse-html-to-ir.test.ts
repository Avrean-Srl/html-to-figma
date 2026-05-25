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
})

function flatten(nodes: ReadonlyArray<import('../../src/types/ir').IRNode>): import('../../src/types/ir').IRNode[] {
  const out: import('../../src/types/ir').IRNode[] = []
  for (const n of nodes) {
    out.push(n)
    if (n.type === 'frame') out.push(...flatten(n.children))
  }
  return out
}
