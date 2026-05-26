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

describe('inline-phrase merge produces one TextNode with ranges', () => {
  it('merges <strong> + text + <strong> into a single IRText carrying the whole sentence', async () => {
    // Used to splinter into multiple IRTexts when the paragraph mixed
    // inline elements with bare text. Now: one merged text with
    // character-range styling for the bolded runs.
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
    expect(texts).toHaveLength(1)
    const merged = texts[0]
    // Single space between the runs (CSS collapses the source whitespace).
    expect(merged.characters).toBe(
      'Pavel R. deployed v2.0.1 to production.'
    )
    // The two <strong> runs surface as bold ranges (weight >= 600).
    expect(merged.ranges).toBeDefined()
    const boldRanges = (merged.ranges ?? []).filter(
      (r) => (r.fontWeight ?? 400) >= 600
    )
    expect(boldRanges.length).toBeGreaterThanOrEqual(2)
    const slices = boldRanges.map((r) => merged.characters.slice(r.start, r.end))
    expect(slices).toContain('Pavel R.')
    expect(slices).toContain('v2.0.1')
  })

  it('does NOT merge nav links inside a flex container', async () => {
    // Regression: `<nav style="display:flex">` with `<a>` links was
    // collapsing into a single text "CatalogoServiziAziendaContatti"
    // because every <a> is an inline-phrase tag. Flex containers must
    // keep their children as distinct visual items.
    const html = `
      <style>
        body { margin: 0; padding: 0; font-family: 'Inter', sans-serif; font-size: 14px; }
      </style>
      <nav style="display: flex; gap: 12px">
        <a href="#">Catalogo</a>
        <a href="#">Servizi</a>
        <a href="#">Azienda</a>
        <a href="#">Contatti</a>
      </nav>
    `
    const ir = await parseHtmlToIR(html, { viewportWidth: 1440 })
    const nav = findFrameByTag(ir.root, 'nav')
    expect(nav).not.toBeNull()
    if (nav) {
      const texts = findAllTexts(nav)
      // Each link keeps its own IRText.
      const labels = texts.map((t) => t.characters)
      expect(labels).toContain('Catalogo')
      expect(labels).toContain('Servizi')
      expect(labels).toContain('Azienda')
      expect(labels).toContain('Contatti')
      // No glued-together blob.
      expect(labels.every((l) => !l.includes('CatalogoServizi'))).toBe(true)
    }
  })

  it('does NOT merge inside a CSS Grid container', async () => {
    const html = `
      <style> .row { display: grid; grid-template-columns: auto 1fr; gap: 12px; } </style>
      <div class="row">
        <span>Label</span>
        <span>Value</span>
      </div>
    `
    const ir = await parseHtmlToIR(html, { viewportWidth: 1440 })
    const row = findFrameByTag(ir.root, 'div')
    if (row) {
      const labels = findAllTexts(row).map((t) => t.characters)
      expect(labels).toContain('Label')
      expect(labels).toContain('Value')
    }
  })

  it('respects the line height of the parent regardless of wrap width', async () => {
    // Regression: the merged IRText should still measure ONE line
    // height, not collapse into a sliver. Narrow containers wrap
    // internally inside Figma's text node.
    const html = `
      <style>
        body { margin: 0; padding: 0; font-family: 'Inter', sans-serif; font-size: 14px; line-height: 22px; }
        .box { width: 220px; padding: 8px; }
      </style>
      <div class="box"><strong>Pavel R.</strong> deployed <strong>v2.0.1</strong> to production.</div>
    `
    const ir = await parseHtmlToIR(html, { viewportWidth: 1440 })
    const box = findFrameByTag(ir.root, 'div')
    const texts = findAllTexts(box as IRFrame)
    expect(texts).toHaveLength(1)
    expect(texts[0].lineHeight).toBeGreaterThanOrEqual(20)
  })

  it('a paragraph with inline phrases lands as a single merged text node', async () => {
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
    expect(texts).toHaveLength(1)
    expect(texts[0].characters).toContain('Sasha L.')
    expect(texts[0].characters).toContain('SOC2 renewal')
    // Bold range markers preserved on the merged text.
    const boldSlices = (texts[0].ranges ?? [])
      .filter((r) => (r.fontWeight ?? 400) >= 600)
      .map((r) => texts[0].characters.slice(r.start, r.end))
    expect(boldSlices).toContain('Sasha L.')
    expect(boldSlices).toContain('SOC2 renewal')
  })
})
