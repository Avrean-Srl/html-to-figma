import { afterEach, describe, expect, it } from 'vitest'

import { extractAutoLayout } from '../../src/parser/auto-layout'

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

describe('extractAutoLayout', () => {
  it('returns null for non-flex display', () => {
    const el = styled('display: block')
    expect(extractAutoLayout(getComputedStyle(el))).toBeNull()
  })

  it('returns null for display: grid (browser positions are kept absolute)', () => {
    // Earlier iterations tried to map grid -> Figma Auto Layout, but
    // that reflowed multi-row card grids onto a single line and broke
    // ::before pseudos inside grid items. We now trust the browser
    // measured rects for any grid layout: each child lands at its
    // pixel position in its parent without auto-layout.
    const el = styled('display: grid; grid-template-columns: auto 1fr')
    expect(extractAutoLayout(getComputedStyle(el))).toBeNull()
  })

  it('returns null for any grid template (uniform, fr-fr, etc.)', () => {
    const el = styled('display: grid; grid-template-columns: 1fr 1fr 1fr')
    expect(extractAutoLayout(getComputedStyle(el))).toBeNull()
  })

  it('detects display: flex with default row direction', () => {
    const el = styled('display: flex')
    const al = extractAutoLayout(getComputedStyle(el))
    expect(al).not.toBeNull()
    expect(al?.direction).toBe('horizontal')
  })

  it('detects display: inline-flex', () => {
    const el = styled('display: inline-flex')
    const al = extractAutoLayout(getComputedStyle(el))
    expect(al).not.toBeNull()
  })

  it('maps flex-direction: column to vertical', () => {
    const el = styled('display: flex; flex-direction: column')
    expect(extractAutoLayout(getComputedStyle(el))?.direction).toBe('vertical')
  })

  it('reads column-gap for horizontal direction, row-gap for vertical', () => {
    const horizontal = styled('display: flex; column-gap: 12px; row-gap: 99px')
    expect(extractAutoLayout(getComputedStyle(horizontal))?.gap).toBe(12)

    const vertical = styled(
      'display: flex; flex-direction: column; column-gap: 99px; row-gap: 8px'
    )
    expect(extractAutoLayout(getComputedStyle(vertical))?.gap).toBe(8)
  })

  it('reads shorthand gap as both row and column', () => {
    const el = styled('display: flex; gap: 16px')
    expect(extractAutoLayout(getComputedStyle(el))?.gap).toBe(16)
  })

  it('extracts padding per side', () => {
    const el = styled(
      'display: flex; padding-top: 8px; padding-right: 16px; padding-bottom: 24px; padding-left: 32px'
    )
    const al = extractAutoLayout(getComputedStyle(el))
    expect(al?.padding).toEqual({ top: 8, right: 16, bottom: 24, left: 32 })
  })

  it('maps justify-content variants to primaryAxisAlign', () => {
    const cases: Array<[string, 'min' | 'center' | 'max' | 'space-between']> = [
      ['flex-start', 'min'],
      ['center', 'center'],
      ['flex-end', 'max'],
      ['space-between', 'space-between'],
      ['space-around', 'space-between'],
      ['space-evenly', 'space-between']
    ]
    for (const [css, expected] of cases) {
      const el = styled(`display: flex; justify-content: ${css}`)
      expect(
        extractAutoLayout(getComputedStyle(el))?.primaryAxisAlign,
        `justify-content: ${css}`
      ).toBe(expected)
    }
  })

  it('maps align-items variants to counterAxisAlign', () => {
    const cases: Array<[string, 'min' | 'center' | 'max']> = [
      ['flex-start', 'min'],
      ['center', 'center'],
      ['flex-end', 'max'],
      ['stretch', 'min']
    ]
    for (const [css, expected] of cases) {
      const el = styled(`display: flex; align-items: ${css}`)
      expect(
        extractAutoLayout(getComputedStyle(el))?.counterAxisAlign,
        `align-items: ${css}`
      ).toBe(expected)
    }
  })

  it('detects flex-wrap', () => {
    const noWrap = styled('display: flex')
    expect(extractAutoLayout(getComputedStyle(noWrap))?.wrap).toBe(false)

    const wrap = styled('display: flex; flex-wrap: wrap')
    expect(extractAutoLayout(getComputedStyle(wrap))?.wrap).toBe(true)
  })
})
