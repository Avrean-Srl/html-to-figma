import { afterEach, describe, expect, it } from 'vitest'

import { parseHtmlToIR } from '../../src/parser'
import type { IRFrame, IRNode, IRText } from '../../src/types/ir'

function findAllTexts(node: IRNode, out: IRText[] = []): IRText[] {
  if (node.type === 'text') {
    out.push(node)
    return out
  }
  if (node.type !== 'frame') return out
  for (const c of node.children) findAllTexts(c, out)
  return out
}

function findFrameByTag(
  node: IRNode,
  tag: string
): IRFrame | null {
  if (node.type === 'frame' && node.sourceTag === tag) return node
  if (node.type !== 'frame') return null
  for (const c of node.children) {
    const r = findFrameByTag(c, tag)
    if (r !== null) return r
  }
  return null
}

describe('inline text wrapping splits into one IRText per line', () => {
  it('a loose text node wrapping to two lines produces two IRText nodes', async () => {
    // Narrow container forces "to production." to wrap below "v2.0.1".
    const html = `
      <style>
        body { margin: 0; padding: 0; font-family: 'Inter', sans-serif; font-size: 14px; }
        .box { width: 220px; padding: 8px; }
      </style>
      <div class="box"><strong>Pavel R.</strong> deployed <strong>v2.0.1</strong> to production.</div>
    `
    const ir = await parseHtmlToIR(html, { viewportWidth: 1440 })
    const box = findFrameByTag(ir.root, 'div')
    expect(box).not.toBeNull()

    const texts = findAllTexts(box as IRFrame)
    const tail = texts.filter((t) => t.characters.includes('production'))
    // Either one IRText with characters "to production." that lives on a
    // single visual line, OR if it wrapped, two IRText nodes with
    // non-overlapping bounding rects.
    expect(tail.length).toBeGreaterThanOrEqual(1)
    // No text run should be more than ~2 line-heights tall — the bug was
    // a single tall node spanning both lines.
    for (const t of tail) {
      expect(t.layout.height).toBeLessThan(40)
    }
  })

  it('preserves whitespace between inline runs (no "Pavel R.deployed" smushing)', async () => {
    // The text node " deployed " (with leading + trailing spaces) sits
    // between two <strong> elements. The walker must keep those spaces
    // in the IRText characters, otherwise Figma renders "Pavel R."
    // immediately adjacent to "deployed" with no visible gap because
    // the layout rect was sized to include the spaces.
    const html = `
      <style>
        body { margin: 0; padding: 0; font-family: 'Inter', sans-serif; font-size: 14px; }
        .row { width: 400px; }
      </style>
      <div class="row"><strong>Pavel R.</strong> deployed <strong>v2.0.1</strong> to production.</div>
    `
    const ir = await parseHtmlToIR(html, { viewportWidth: 1440 })
    const box = findFrameByTag(ir.root, 'div')
    expect(box).not.toBeNull()
    const texts = findAllTexts(box as IRFrame)

    const deployed = texts.find((t) => t.characters.includes('deployed'))
    const toProduction = texts.find((t) => t.characters.includes('production'))

    expect(deployed?.characters).toMatch(/^\s/)
    expect(deployed?.characters).toMatch(/\s$/)
    expect(toProduction?.characters).toMatch(/^\s/)
  })

  it('all inline runs in a wrapping paragraph have non-overlapping y bands', async () => {
    const html = `
      <style>
        body { margin: 0; padding: 0; font-family: 'Inter', sans-serif; font-size: 14px; }
        .activity { width: 240px; }
      </style>
      <div class="activity"><strong>Sasha L.</strong> requested approval on <strong>SOC2 renewal</strong>.</div>
    `
    const ir = await parseHtmlToIR(html, { viewportWidth: 1440 })
    const box = findFrameByTag(ir.root, 'div')
    expect(box).not.toBeNull()

    const texts = findAllTexts(box as IRFrame)
    // Sort by y, then for each pair of adjacent nodes that share an
    // overlapping y band, x ranges must NOT overlap (siblings on same
    // line must not overlap horizontally).
    const sorted = [...texts].sort((a, b) => a.layout.y - b.layout.y)
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]
      const b = sorted[i + 1]
      const aMidY = a.layout.y + a.layout.height / 2
      const bMidY = b.layout.y + b.layout.height / 2
      const sameLine = Math.abs(aMidY - bMidY) < a.layout.height / 2
      if (!sameLine) continue
      const aRight = a.layout.x + a.layout.width
      const bRight = b.layout.x + b.layout.width
      const horizontalOverlap = !(aRight <= b.layout.x || bRight <= a.layout.x)
      expect(
        horizontalOverlap,
        `runs "${a.characters}" and "${b.characters}" overlap on the same line`
      ).toBe(false)
    }
  })
})
