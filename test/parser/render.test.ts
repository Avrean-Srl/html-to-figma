import { afterEach, describe, expect, it } from 'vitest'

import { renderHidden, type RenderHandle } from '../../src/parser/render'

describe('renderHidden — CSS body rules apply to the harness root', () => {
  let handle: RenderHandle | null = null

  afterEach(() => {
    handle?.cleanup()
    handle = null
  })

  it('picks up `body { background: ... }` from a <style> rule', async () => {
    handle = await renderHidden(
      `<style>body { background: rgb(248, 250, 252); }</style>
       <p>hi</p>`,
      1440
    )
    const cs = getComputedStyle(handle.body)
    expect(cs.backgroundColor).toBe('rgb(248, 250, 252)')
  })

  it('picks up `body { padding: ... }` so root content is inset', async () => {
    handle = await renderHidden(
      `<style>body { margin: 0; padding: 48px; background: white; }</style>
       <p>hi</p>`,
      1440
    )
    const cs = getComputedStyle(handle.body)
    expect(cs.paddingTop).toBe('48px')
    expect(cs.paddingLeft).toBe('48px')
  })

  it('picks up `body { color: ... }` for inherited text color', async () => {
    handle = await renderHidden(
      `<style>body { color: rgb(15, 23, 42); }</style>
       <p>hi</p>`,
      1440
    )
    const cs = getComputedStyle(handle.body)
    expect(cs.color).toBe('rgb(15, 23, 42)')
  })

  it('activates desktop @media (min-width: 1024px) rules when viewportWidth is 1440', async () => {
    handle = await renderHidden(
      `<style>
        .x { background: rgb(10, 10, 10); }
        @media (min-width: 1024px) { .x { background: rgb(200, 50, 50); } }
       </style>
       <div class="x">hi</div>`,
      1440
    )
    const el = handle.body.querySelector('.x') as HTMLElement
    expect(el).not.toBeNull()
    expect(getComputedStyle(el).backgroundColor).toBe('rgb(200, 50, 50)')
  })

  it('keeps mobile rules when viewportWidth is 320', async () => {
    handle = await renderHidden(
      `<style>
        .x { background: rgb(10, 10, 10); }
        @media (min-width: 1024px) { .x { background: rgb(200, 50, 50); } }
       </style>
       <div class="x">hi</div>`,
      320
    )
    const el = handle.body.querySelector('.x') as HTMLElement
    expect(getComputedStyle(el).backgroundColor).toBe('rgb(10, 10, 10)')
  })

  it('does not let `min-height: 100vh` balloon body height past content', async () => {
    // The regression we were chasing on boero-mockup: admin pages had
    // `.admin-layout { min-height: 100vh }` and the harness iframe was
    // hard-coded to 24000 px. Result: body filled the iframe and the
    // imported frame was 1440 x 24000. With the viewport-sized harness
    // and no post-load resize, 100vh is bounded.
    handle = await renderHidden(
      `<style>
        body { margin: 0 }
        .layout { min-height: 100vh; background: rgb(20, 20, 20); }
        .content { height: 600px }
       </style>
       <div class="layout"><div class="content"></div></div>`,
      1440
    )
    const layout = handle.body.querySelector('.layout') as HTMLElement
    const rect = layout.getBoundingClientRect()
    expect(rect.height).toBeLessThan(2000)
    expect(rect.height).toBeGreaterThanOrEqual(600)
  })

  it('hides scrollbar so body width equals viewportWidth (no 17px gutter)', async () => {
    // Without the harness preamble, a body taller than the iframe
    // grew a vertical scrollbar that ate ~17 px off the right side,
    // leaving an empty stripe in every imported frame.
    handle = await renderHidden(
      `<style>body { margin: 0 }</style>
       <div style="height: 5000px; background: rgb(50, 50, 50)"></div>`,
      1440
    )
    const bodyRect = handle.body.getBoundingClientRect()
    expect(bodyRect.width).toBe(1440)
  })

  it('does not capture a CSS transition mid-flight', async () => {
    // A transition with a long duration would normally settle on its
    // FROM state (opacity 0) right after load. The harness preamble
    // overrides `transition-duration: 0s` so the value snaps straight
    // to the TO state.
    handle = await renderHidden(
      `<style>
        .target {
          opacity: 0;
          transition: opacity 10s linear;
        }
        body.ready .target { opacity: 1; }
       </style>
       <body class="ready">
         <div class="target" style="width: 100px; height: 100px; background: red"></div>
       </body>`,
      1440
    )
    const target = handle.body.querySelector('.target') as HTMLElement
    // With transitions disabled, the cascade jumps straight to the
    // "ready" state; computed opacity should be 1 (or extremely close).
    const opacity = parseFloat(getComputedStyle(target).opacity)
    expect(opacity).toBeGreaterThan(0.95)
  })

  it('forces .reveal-style elements to their final state (opacity 1, transform none)', async () => {
    // Mirrors boero's pattern: `.reveal { opacity: 0; transform:
    // translateY(12px); transition: opacity ..., transform ... }`,
    // with JS adding `.is-visible` via IntersectionObserver on scroll.
    // We strip scripts, so without the harness override the element
    // would import invisible.
    handle = await renderHidden(
      `<style>
        .reveal {
          opacity: 0;
          transform: translateY(12px);
          transition: opacity 800ms ease, transform 800ms ease;
        }
       </style>
       <div class="reveal" style="width: 100px; height: 100px; background: red"></div>`,
      1440
    )
    const target = handle.body.querySelector('.reveal') as HTMLElement
    expect(parseFloat(getComputedStyle(target).opacity)).toBe(1)
    // Transform should resolve to identity matrix or 'none'.
    const t = getComputedStyle(target).transform
    expect(t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true)
  })

  it('does NOT touch elements that are intentionally dim without an opacity transition', async () => {
    // A chip with `opacity: 0.5` at rest (no transition) means the
    // designer wants it dim. We must not promote it to opacity 1.
    handle = await renderHidden(
      `<style>
        .chip { opacity: 0.5; }
       </style>
       <span class="chip">muted</span>`,
      1440
    )
    const target = handle.body.querySelector('.chip') as HTMLElement
    expect(parseFloat(getComputedStyle(target).opacity)).toBe(0.5)
  })

  it('applies oklch() backgrounds via the shim even when the runtime would drop them', async () => {
    // boero --surface-base ≈ oklch(99.5% 0.002 25) ≈ near white.
    // The shim rewrites it to a literal rgb() before injection so the
    // body's background is captured regardless of the Chromium build.
    handle = await renderHidden(
      `<style>body { background: oklch(99.5% 0.002 25); margin: 0 }</style>
       <p>x</p>`,
      1440
    )
    const cs = getComputedStyle(handle.body)
    const match = cs.backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    expect(match).not.toBeNull()
    if (match) {
      const [r, g, b] = match.slice(1, 4).map(Number)
      expect(r).toBeGreaterThan(240)
      expect(g).toBeGreaterThan(240)
      expect(b).toBeGreaterThan(240)
    }
  })
})
