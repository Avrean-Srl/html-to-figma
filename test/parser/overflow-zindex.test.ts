import { afterEach, describe, expect, it } from 'vitest'

import { extractClipsContent, extractZIndex } from '../../src/parser/styles'

const mounted: HTMLElement[] = []

function styled(css: string): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = css
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

afterEach(() => {
  while (mounted.length > 0) {
    const el = mounted.pop()
    el?.remove()
  }
})

describe('extractZIndex', () => {
  it('returns 0 for auto', () => {
    const el = styled('z-index: auto')
    expect(extractZIndex(getComputedStyle(el))).toBe(0)
  })

  it('returns 0 when unset', () => {
    const el = styled('width: 10px')
    expect(extractZIndex(getComputedStyle(el))).toBe(0)
  })

  it('parses positive integers', () => {
    const el = styled('position: relative; z-index: 42')
    expect(extractZIndex(getComputedStyle(el))).toBe(42)
  })

  it('parses negative integers', () => {
    const el = styled('position: relative; z-index: -5')
    expect(extractZIndex(getComputedStyle(el))).toBe(-5)
  })
})

describe('extractClipsContent', () => {
  it('returns false for visible overflow', () => {
    const el = styled('overflow: visible')
    expect(extractClipsContent(getComputedStyle(el))).toBe(false)
  })

  it('returns true for overflow: hidden', () => {
    const el = styled('overflow: hidden')
    expect(extractClipsContent(getComputedStyle(el))).toBe(true)
  })

  it('returns true when only one axis is hidden', () => {
    const el = styled('overflow-x: hidden; overflow-y: visible')
    expect(extractClipsContent(getComputedStyle(el))).toBe(true)
  })
})
