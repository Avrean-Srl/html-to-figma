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

  it('returns null for per-side borders (Phase 3.1 limitation)', () => {
    const el = styled(
      'width: 100px; height: 50px; border-bottom: 2px solid red'
    )
    expect(extractStroke(getComputedStyle(el))).toBeNull()
  })

  it('returns null when border-style is none even if width is set', () => {
    const el = styled('width: 100px; height: 50px; border: 2px none red')
    expect(extractStroke(getComputedStyle(el))).toBeNull()
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
