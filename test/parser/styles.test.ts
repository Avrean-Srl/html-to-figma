import { afterEach, describe, expect, it } from 'vitest'

import {
  extractBlendMode,
  extractStroke
} from '../../src/parser/styles'

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

describe('extractStroke', () => {
  it('returns null when there is no border', () => {
    const el = styled('width: 100px; height: 50px')
    expect(extractStroke(getComputedStyle(el))).toBeNull()
  })

  it('returns stroke for a uniform border', () => {
    const el = styled(
      'width: 100px; height: 50px; border: 2px solid rgb(255, 0, 0)'
    )
    const stroke = extractStroke(getComputedStyle(el))
    expect(stroke).not.toBeNull()
    expect(stroke?.width).toBe(2)
    expect(stroke?.color.r).toBe(1)
  })

  it('captures a per-side border as individual stroke weights', () => {
    const el = styled(
      'width: 100px; height: 50px; border-bottom: 2px solid rgb(255, 0, 0)'
    )
    const stroke = extractStroke(getComputedStyle(el))
    expect(stroke).not.toBeNull()
    expect(stroke?.sides).toEqual({ top: 0, right: 0, bottom: 2, left: 0 })
    // Color/style come from the painting (bottom) side, not the
    // zero-width sides whose color defaults to the element text color.
    expect(stroke?.color.r).toBe(1)
    expect(stroke?.style).toBe('solid')
  })

  it('keeps a uniform border as a single weight (no per-side data)', () => {
    const el = styled(
      'width: 100px; height: 50px; border: 3px solid rgb(0, 0, 0)'
    )
    const stroke = extractStroke(getComputedStyle(el))
    expect(stroke?.width).toBe(3)
    expect(stroke?.sides).toBeUndefined()
  })

  it('captures asymmetric widths (border-top thicker than border-bottom)', () => {
    const el = styled(
      'width: 100px; height: 50px; border-top: 4px solid rgb(0, 0, 0); border-bottom: 1px solid rgb(0, 0, 0)'
    )
    const stroke = extractStroke(getComputedStyle(el))
    expect(stroke?.sides).toEqual({ top: 4, right: 0, bottom: 1, left: 0 })
  })

  it('returns null when border-style is none even if width is set', () => {
    const el = styled('width: 100px; height: 50px; border: 2px none red')
    expect(extractStroke(getComputedStyle(el))).toBeNull()
  })

  it('captures dashed border style', () => {
    const el = styled(
      'width: 100px; height: 50px; border: 2px dashed rgb(0, 0, 0)'
    )
    const stroke = extractStroke(getComputedStyle(el))
    expect(stroke?.style).toBe('dashed')
  })

  it('captures dotted border style', () => {
    const el = styled(
      'width: 100px; height: 50px; border: 2px dotted rgb(0, 0, 0)'
    )
    const stroke = extractStroke(getComputedStyle(el))
    expect(stroke?.style).toBe('dotted')
  })

  it('defaults to solid for unsupported border styles (groove, ridge, double)', () => {
    const el = styled(
      'width: 100px; height: 50px; border: 4px double rgb(0, 0, 0)'
    )
    const stroke = extractStroke(getComputedStyle(el))
    expect(stroke?.style).toBe('solid')
  })
})

describe('extractBlendMode', () => {
  it('defaults to normal', () => {
    const el = styled('width: 100px; height: 50px')
    expect(extractBlendMode(getComputedStyle(el))).toBe('normal')
  })

  it('passes through CSS keyword values', () => {
    const cases: Array<[string, string]> = [
      ['multiply', 'multiply'],
      ['screen', 'screen'],
      ['overlay', 'overlay'],
      ['difference', 'difference'],
      ['luminosity', 'luminosity']
    ]
    for (const [css, expected] of cases) {
      const el = styled(`mix-blend-mode: ${css}`)
      expect(extractBlendMode(getComputedStyle(el))).toBe(expected)
    }
  })
})
