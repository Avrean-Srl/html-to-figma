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
})
