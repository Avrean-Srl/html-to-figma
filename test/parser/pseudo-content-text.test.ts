import { afterEach, describe, expect, it } from 'vitest'

import { walkDocument } from '../../src/parser/walker'
import type { IRNode } from '../../src/types/ir'

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

function collectTexts(node: IRNode, out: string[] = []): string[] {
  if (node.type === 'text') out.push(node.characters)
  if (node.type === 'frame') for (const c of node.children) collectTexts(c, out)
  return out
}

describe('text content in ::before / ::after produces IRText nodes', () => {
  it('renders the ✓ check mark from .feature-list li::before', () => {
    const container = setup(`
      <style>
        .feature-list li::before {
          content: "✓";
          color: rgb(186, 33, 37);
          font-weight: 700;
        }
      </style>
      <ul class="feature-list"><li>Climatizzatore</li></ul>
    `)
    const result = walkDocument(container, 1440)
    const texts = collectTexts(result.root)
    expect(texts).toContain('✓')
  })

  it('renders the → arrow from .btn-link::after', () => {
    const container = setup(`
      <style>
        .btn-link::after { content: "→"; font-family: monospace; }
      </style>
      <a class="btn-link">Scheda</a>
    `)
    const result = walkDocument(container, 1440)
    const texts = collectTexts(result.root)
    expect(texts).toContain('→')
  })

  it('does not emit text when content is url() (image pseudo)', () => {
    const container = setup(`
      <style>
        .x::before { content: url("data:image/png;base64,AAAA"); }
      </style>
      <div class="x">label</div>
    `)
    const result = walkDocument(container, 1440)
    const texts = collectTexts(result.root)
    // Only "label" - no spurious empty pseudo text.
    expect(texts).toEqual(['label'])
  })
})

describe('iframe / embed render as placeholder frames', () => {
  it('emits an IRImage for a Google Maps iframe so the OSM resolver can swap in a real map', () => {
    const container = setup(`
      <iframe src="https://maps.google.com/?q=test" style="width: 400px; height: 280px; border: 0"></iframe>
    `)
    const result = walkDocument(container, 1440)
    const ph = result.root.children[0]
    expect(ph.type).toBe('image')
    if (ph.type === 'image') {
      expect(ph.sourceUrl).toContain('maps.google.com')
      expect(ph.layout.width).toBe(400)
      expect(ph.layout.height).toBe(280)
      // loadStatus 'pending' triggers the OSM static-map resolution
      // step in images.ts.
      expect(ph.loadStatus).toBe('pending')
    }
  })
})

describe('pseudo positioning honours parent padding + transform translate', () => {
  it('absolute pseudo with inset:0 lands at parent border-box edge (no padding offset)', () => {
    // CSS containing-block for an absolutely-positioned pseudo is the
    // parent's PADDING-box, NOT the content-box. When the parent has
    // border:0 (the common case), padding-box.left === border-box.left,
    // so an inset:0 pseudo lands AT the parent's outer edge - the
    // login-side gradient overflow regression was caused by adding the
    // padding amount on top of that origin.
    const container = setup(`
      <style>
        .card {
          position: relative;
          width: 200px;
          height: 100px;
          padding: 20px;
          background: white;
        }
        .card::before {
          content: "";
          position: absolute;
          inset: 0;
          background: rgb(255, 0, 0);
        }
      </style>
      <div class="card">x</div>
    `)
    const result = walkDocument(container, 1440)
    const card = result.root.children[0]
    if (card.type === 'frame') {
      const pseudo = card.children.find(
        (c) => c.type === 'frame' && c.sourceTag === 'before'
      )
      expect(pseudo).toBeDefined()
      if (pseudo && pseudo.type === 'frame') {
        // No border, so padding-box.left == border-box.left == card.x.
        const cardX = card.layout.x
        expect(pseudo.layout.x - cardX).toBe(0)
      }
    }
  })

  it('absolute pseudo with inset:0 honours border width (offset = border, not padding)', () => {
    const container = setup(`
      <style>
        .card {
          position: relative;
          width: 200px;
          height: 100px;
          padding: 20px;
          border: 4px solid black;
        }
        .card::before {
          content: "";
          position: absolute;
          inset: 0;
          background: rgb(255, 0, 0);
        }
      </style>
      <div class="card">x</div>
    `)
    const result = walkDocument(container, 1440)
    const card = result.root.children[0]
    if (card.type === 'frame') {
      const pseudo = card.children.find(
        (c) => c.type === 'frame' && c.sourceTag === 'before'
      )
      if (pseudo && pseudo.type === 'frame') {
        // 4px border -> padding-box.left is offset by 4 from
        // border-box.left, so pseudo at inset:0 sits 4 px in.
        expect(Math.round(pseudo.layout.x - card.layout.x)).toBe(4)
      }
    }
  })

  it('orders absolute siblings by z-index ASC so the deepest renders first', () => {
    // Boero hero stack: image wrapper (z=-2) below gradient (z=-1)
    // below content (z=0). All three must sort by z-index ASC in the
    // children array so Figma's flow-order renders them bottom-up.
    const container = setup(`
      <style>
        .hero { position: relative; display: flex; width: 400px; height: 200px; }
        .bg { position: absolute; inset: 0; z-index: -2; background: red; }
        .hero::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -1;
          background: rgba(0, 0, 0, 0.5);
        }
      </style>
      <section class="hero">
        <div class="bg"></div>
        <div class="content" style="width: 200px; height: 100px; background: blue"></div>
      </section>
    `)
    const result = walkDocument(container, 1440)
    const hero = result.root.children[0]
    expect(hero.type).toBe('frame')
    if (hero.type === 'frame') {
      // Expected order: bg (z=-2), ::after (z=-1), content (z=0).
      expect(hero.children).toHaveLength(3)
      const first = hero.children[0]
      const second = hero.children[1]
      const third = hero.children[2]
      // First slot: most-negative-z absolute (the bg, z=-2).
      expect(first.zIndex).toBe(-2)
      expect(first.positioning).toBe('absolute')
      // Second slot: ::after pseudo (z=-1).
      expect(second.zIndex).toBe(-1)
      if (second.type === 'frame') expect(second.sourceTag).toBe('after')
      // Third slot: in-flow content (z=0 or auto).
      expect(third.positioning ?? 'auto').toBe('auto')
    }
  })

  it('puts a ::after with z-index: -1 BEFORE other children (so it renders behind)', () => {
    // Boero hero: <section class="hero-fullpage"> has `display: flex`
    // and its `::after` is the dark gradient overlay positioned
    // `inset: 0; z-index: -1`. In Figma's flow-order rendering, that
    // means it must come FIRST in the children list so the image and
    // text land on top of it. If we appended it last, the gradient
    // would darken the whole hero, exactly what happened in v0.2.5.
    const container = setup(`
      <style>
        .hero {
          position: relative;
          display: flex;
          width: 400px;
          height: 200px;
        }
        .hero::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -1;
          background: rgba(0, 0, 0, 0.5);
        }
      </style>
      <section class="hero">
        <div style="background: red; width: 100%; height: 100%"></div>
      </section>
    `)
    const result = walkDocument(container, 1440)
    const hero = result.root.children[0]
    expect(hero.type).toBe('frame')
    if (hero.type === 'frame') {
      // First child must be the negative-z-index pseudo, otherwise
      // it'd render on top.
      const first = hero.children[0]
      expect(first.type).toBe('frame')
      if (first.type === 'frame') {
        expect(first.sourceTag).toBe('after')
        expect(first.zIndex).toBeLessThan(0)
      }
    }
  })

  it('honours transform: translate(-50%, -50%) on a centered cross icon', () => {
    // `display: inline-block` is required for CSS width/height to take
    // effect on a <span>; without it the icon collapses to its inline
    // content size (0 here) and the test asserts on bogus geometry.
    const container = setup(`
      <style>
        .icon {
          position: relative;
          display: inline-block;
          width: 24px;
          height: 24px;
        }
        .icon::before {
          content: "";
          position: absolute;
          top: 50%;
          left: 50%;
          width: 10px;
          height: 1.5px;
          background: black;
          transform: translate(-50%, -50%);
        }
      </style>
      <span class="icon"></span>
    `)
    const result = walkDocument(container, 1440)
    const icon = result.root.children[0]
    if (icon.type === 'frame') {
      const pseudo = icon.children.find(
        (c) => c.type === 'frame' && c.sourceTag === 'before'
      )
      expect(pseudo).toBeDefined()
      if (pseudo && pseudo.type === 'frame') {
        // Icon is 24x24. Centered cross midX = 12, pseudo width 10
        // -> left edge sits at midX - width/2 = 12 - 5 = 7.
        const iconX = icon.layout.x
        expect(Math.round(pseudo.layout.x - iconX)).toBe(7)
      }
    }
  })
})
