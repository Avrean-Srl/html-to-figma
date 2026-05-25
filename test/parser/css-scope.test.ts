import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { renderHidden, type RenderHandle } from '../../src/parser/render'

// The harness container is a <body> element so that user CSS rules like
// `body { background: white }` match. But those rules ALSO match the
// outer plugin UI body, causing a brief visual flash (e.g. dark plugin UI
// turns light for ~100ms during import). The harness scopes body rules
// to `body[aria-hidden="true"]` (the attribute is only set on the
// container) so they apply only there.

describe('body CSS rules do not leak to the outer plugin UI body', () => {
  let handle: RenderHandle | null = null
  let originalBg: string

  beforeEach(() => {
    originalBg = getComputedStyle(document.body).backgroundColor
  })

  afterEach(() => {
    handle?.cleanup()
    handle = null
  })

  it('does not change document.body background when imported HTML sets `body { background: ... }`', async () => {
    handle = await renderHidden(
      `<style>body { background: rgb(255, 0, 128); }</style><p>x</p>`,
      1440
    )
    const outerBg = getComputedStyle(document.body).backgroundColor
    expect(outerBg).toBe(originalBg)
  })

  it('still applies the rule to the harness container itself', async () => {
    handle = await renderHidden(
      `<style>body { background: rgb(255, 0, 128); }</style><p>x</p>`,
      1440
    )
    const containerBg = getComputedStyle(handle.body).backgroundColor
    expect(containerBg).toBe('rgb(255, 0, 128)')
  })

  it('handles comma-separated selectors that include body', async () => {
    handle = await renderHidden(
      `<style>body, html { background: rgb(0, 200, 50); }</style><p>x</p>`,
      1440
    )
    expect(getComputedStyle(handle.body).backgroundColor).toBe('rgb(0, 200, 50)')
    // outer doc.body should not be green
    expect(getComputedStyle(document.body).backgroundColor).toBe(originalBg)
  })

  it('does not rewrite identifiers that contain the substring "body" (e.g. .body-text)', async () => {
    handle = await renderHidden(
      `<style>
        body { background: rgb(10, 20, 30); }
        .body-text { color: rgb(255, 200, 0); }
      </style>
      <p class="body-text">x</p>`,
      1440
    )
    const p = handle.body.querySelector('.body-text') as HTMLElement
    expect(p).not.toBeNull()
    expect(getComputedStyle(p).color).toBe('rgb(255, 200, 0)')
    expect(getComputedStyle(handle.body).backgroundColor).toBe('rgb(10, 20, 30)')
  })
})
