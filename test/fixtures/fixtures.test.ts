/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'

import { parseHtmlToIR } from '../../src/parser'
import type { IRDocument, IRNode } from '../../src/types/ir'

import alertHtml from './alert.html?raw'
import badgeHtml from './badge.html?raw'
import buttonHtml from './button.html?raw'
import cardHtml from './card.html?raw'
import footerHtml from './footer.html?raw'
import formHtml from './form.html?raw'
import heroHtml from './hero.html?raw'
import mobileNavbarHtml from './mobile-navbar.html?raw'
import navbarHtml from './navbar.html?raw'
import pricingGridHtml from './pricing-grid.html?raw'

interface Fixture {
  name: string
  html: string
  // Lower bound on total node count. Loose enough that small refactors
  // of the parser do not break the suite, tight enough to catch
  // regressions where whole subtrees go missing.
  minNodes: number
}

const FIXTURES: Fixture[] = [
  { name: 'card', html: cardHtml, minNodes: 4 },
  { name: 'navbar', html: navbarHtml, minNodes: 6 },
  { name: 'hero', html: heroHtml, minNodes: 4 },
  { name: 'form', html: formHtml, minNodes: 8 },
  { name: 'pricing-grid', html: pricingGridHtml, minNodes: 13 },
  { name: 'button', html: buttonHtml, minNodes: 3 },
  { name: 'badge', html: badgeHtml, minNodes: 4 },
  { name: 'alert', html: alertHtml, minNodes: 3 },
  { name: 'mobile-navbar', html: mobileNavbarHtml, minNodes: 6 },
  { name: 'footer', html: footerHtml, minNodes: 12 }
]

function flatten(nodes: ReadonlyArray<IRNode>): IRNode[] {
  const out: IRNode[] = []
  for (const n of nodes) {
    out.push(n)
    if (n.type === 'frame') out.push(...flatten(n.children))
  }
  return out
}

function collectAllNodes(ir: IRDocument): IRNode[] {
  return [ir.root, ...flatten(ir.root.children)]
}

describe('Tailwind / shadcn fixture suite', () => {
  it.each(FIXTURES)(
    'parses $name into a structurally valid IRDocument',
    async ({ name, html, minNodes }) => {
      const ir = await parseHtmlToIR(html, { viewportWidth: 1440 })

      expect(ir.root.type, `${name}: root is frame`).toBe('frame')
      expect(ir.viewportWidth).toBe(1440)

      const allNodes = collectAllNodes(ir)

      // Unique ids end-to-end
      const ids = allNodes.map((n) => n.id)
      expect(new Set(ids).size, `${name}: ids unique`).toBe(ids.length)

      // No negative dimensions
      for (const n of allNodes) {
        expect(n.layout.width, `${name}: ${n.id} width >= 0`).toBeGreaterThanOrEqual(0)
        expect(n.layout.height, `${name}: ${n.id} height >= 0`).toBeGreaterThanOrEqual(0)
      }

      // Frame fills stay in 0-1 channel range (per stop for gradients).
      for (const n of allNodes) {
        if (n.type !== 'frame') continue
        for (const fill of n.fills) {
          const colors =
            fill.type === 'solid'
              ? [fill.color]
              : fill.gradient.stops.map((s) => s.color)
          for (const c of colors) {
            expect(c.r).toBeGreaterThanOrEqual(0)
            expect(c.r).toBeLessThanOrEqual(1)
            expect(c.g).toBeGreaterThanOrEqual(0)
            expect(c.g).toBeLessThanOrEqual(1)
            expect(c.b).toBeGreaterThanOrEqual(0)
            expect(c.b).toBeLessThanOrEqual(1)
            expect(c.a).toBeGreaterThanOrEqual(0)
            expect(c.a).toBeLessThanOrEqual(1)
          }
        }
      }

      // Fonts collected and deduped
      const fontKeys = ir.fontsUsed.map(
        (f) => `${f.family}|${f.weight}|${f.style}`
      )
      expect(new Set(fontKeys).size, `${name}: fonts deduped`).toBe(
        fontKeys.length
      )

      // Regression floor on tree size
      expect(allNodes.length, `${name}: at least ${minNodes} nodes`).toBeGreaterThanOrEqual(minNodes)

      const frames = allNodes.filter((n) => n.type === 'frame').length
      const texts = allNodes.filter((n) => n.type === 'text').length
      // eslint-disable-next-line no-console
      console.log(
        `[fixture:${name}] ${allNodes.length} nodes (${frames} frames, ${texts} text), ${ir.fontsUsed.length} unique fonts`
      )
    }
  )
})
