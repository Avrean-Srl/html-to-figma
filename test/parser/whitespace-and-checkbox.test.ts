import { afterEach, describe, expect, it } from 'vitest'

import { walkDocument } from '../../src/parser/walker'
import type { IRFrame, IRText, IRNode } from '../../src/types/ir'

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

function findText(node: IRNode, contains: string): IRText | null {
  if (node.type === 'text' && node.characters.includes(contains)) return node
  if (node.type === 'frame') {
    for (const c of node.children) {
      const r = findText(c, contains)
      if (r) return r
    }
  }
  return null
}

describe('CSS whitespace collapsing in extracted text', () => {
  it('drops indent whitespace around a single-line label inside a flex parent', () => {
    // Real boero nav-link uses <svg> + bare text + <span> badge, which
    // does NOT trigger inline-phrase merge (svg is not an inline
    // phrase), so the bare text survives as its own IRText. We use
    // <svg> here for the same reason - using <span> would have caused
    // the whole <a> to merge into one rich text node and the test
    // would no longer be about edge-whitespace trimming.
    const container = setup(`
      <a style="display: flex; align-items: center; gap: 12px; padding: 8px 12px">
        <svg width="16" height="16"></svg>
          Veicoli
        <span>328</span>
      </a>
    `)
    const result = walkDocument(container, 1440)
    const text = findText(result.root, 'Veicoli')
    expect(text).not.toBeNull()
    if (text) {
      expect(text.characters).toBe('Veicoli')
      expect(text.characters.startsWith(' ')).toBe(false)
      expect(text.characters.endsWith(' ')).toBe(false)
    }
  })

  it('trims edges of a leaf-text element regardless of CSS display', () => {
    const container = setup(`<div>          Veicoli          </div>`)
    const result = walkDocument(container, 1440)
    const text = findText(result.root, 'Veicoli')
    if (text) expect(text.characters).toBe('Veicoli')
  })

  it('preserves single edge spaces inside a normal block run between inline siblings', () => {
    // Regression: when an inline-phrase merge happens (the new default
    // for paragraphs with <strong>/<em>), the merged characters must
    // STILL contain single spaces between "Pavel R.", "deployed", and
    // "v2.0.1" so the merged text reads correctly. Without proper
    // whitespace handling we'd get "Pavel R.deployedv2.0.1".
    const container = setup(`
      <p style="display: block; font-size: 14px"><strong>Pavel R.</strong> deployed <strong>v2.0.1</strong>.</p>
    `)
    const result = walkDocument(container, 1440)
    const merged = findText(result.root, 'deployed')
    expect(merged).not.toBeNull()
    if (merged) {
      expect(merged.characters).toBe('Pavel R. deployed v2.0.1.')
    }
  })

  it('collapses 5 spaces between words to a single space', () => {
    const container = setup(`<div>Hello     world</div>`)
    const result = walkDocument(container, 1440)
    const text = findText(result.root, 'Hello')
    if (text) expect(text.characters).toBe('Hello world')
  })

  it('preserves text exactly when white-space: pre is set', () => {
    const container = setup(
      `<pre style="white-space: pre">line one
   indented
line three</pre>`
    )
    const result = walkDocument(container, 1440)
    const text = findText(result.root, 'indented')
    if (text) expect(text.characters).toContain('   indented')
  })
})

describe('checkbox and radio inputs render as visible controls', () => {
  it('checkbox checked: filled with accent-color, has corner radius and stroke', () => {
    const container = setup(
      `<input type="checkbox" checked style="accent-color: rgb(186, 33, 37); width: 16px; height: 16px" />`
    )
    const result = walkDocument(container, 1440)
    const cb = result.root.children[0]
    expect(cb.type).toBe('frame')
    if (cb.type === 'frame') {
      expect(cb.sourceTag).toBe('checkbox')
      // Filled because checked.
      expect(cb.fills).toHaveLength(1)
      const fill = cb.fills[0]
      if (fill.type === 'solid') {
        // accent-color rgb(186, 33, 37) -> r=186/255, g=33/255, b=37/255.
        expect(Math.round(fill.color.r * 255)).toBe(186)
        expect(Math.round(fill.color.g * 255)).toBe(33)
      }
      expect(cb.stroke).not.toBeNull()
      // Small square radius, not a circle.
      expect(cb.cornerRadius[0]).toBeLessThan(4)
    }
  })

  it('checkbox unchecked: white fill, gray border', () => {
    const container = setup(
      `<input type="checkbox" style="width: 16px; height: 16px" />`
    )
    const result = walkDocument(container, 1440)
    const cb = result.root.children[0]
    if (cb.type === 'frame') {
      expect(cb.sourceTag).toBe('checkbox')
      const fill = cb.fills[0]
      if (fill?.type === 'solid') {
        expect(fill.color.r).toBeGreaterThan(0.9)
        expect(fill.color.g).toBeGreaterThan(0.9)
        expect(fill.color.b).toBeGreaterThan(0.9)
      }
      expect(cb.stroke).not.toBeNull()
    }
  })

  it('radio checked: full-circle corner radius, accent fill', () => {
    const container = setup(
      `<input type="radio" checked style="accent-color: rgb(100, 50, 200); width: 14px; height: 14px" />`
    )
    const result = walkDocument(container, 1440)
    const r = result.root.children[0]
    if (r.type === 'frame') {
      expect(r.sourceTag).toBe('radio')
      // Full circle = radius == max(width, height) / 2.
      expect(r.cornerRadius[0]).toBeGreaterThanOrEqual(7)
    }
  })

  it('label > input + text renders the box AND the label text', () => {
    // The boero pattern: <label flex><input checkbox><text></label>.
    // Both the visual control and the label string must end up in IR.
    const container = setup(`
      <label style="display: flex; align-items: center; gap: 8px">
        <input type="checkbox" checked style="accent-color: rgb(186, 33, 37); width: 14px; height: 14px" />
        Climatizzatore automatico bi-zona
      </label>
    `)
    const result = walkDocument(container, 1440)
    const label = result.root.children[0]
    expect(label.type).toBe('frame')
    if (label.type === 'frame') {
      const cb = label.children.find(
        (c) => c.type === 'frame' && c.sourceTag === 'checkbox'
      )
      expect(cb).toBeDefined()
      const text = findText(label, 'Climatizzatore')
      expect(text).not.toBeNull()
    }
  })
})
