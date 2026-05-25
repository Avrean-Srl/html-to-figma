import { describe, expect, it } from 'vitest'

import { parseColor } from '../../src/parser/color'

describe('parseColor', () => {
  it('parses #rrggbb hex into 0-1 channels with alpha 1', () => {
    expect(parseColor('#ff0000')).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    expect(parseColor('#0000ff')).toEqual({ r: 0, g: 0, b: 1, a: 1 })
  })

  it('parses 3-digit hex via canvas normalization', () => {
    expect(parseColor('#f00')).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  })

  it('parses rgb(...) syntax', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  })

  it('parses rgba(...) and preserves alpha', () => {
    const c = parseColor('rgba(255, 128, 0, 0.5)')
    expect(c.r).toBeCloseTo(1, 5)
    expect(c.g).toBeCloseTo(128 / 255, 5)
    expect(c.b).toBe(0)
    expect(c.a).toBeCloseTo(0.5, 5)
  })

  it('parses named CSS colors', () => {
    const c = parseColor('rebeccapurple')
    expect(c.r).toBeCloseTo(102 / 255, 5)
    expect(c.g).toBeCloseTo(51 / 255, 5)
    expect(c.b).toBeCloseTo(153 / 255, 5)
    expect(c.a).toBe(1)
  })

  it('returns fully transparent for "transparent"', () => {
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('returns fully transparent for empty string', () => {
    expect(parseColor('')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('falls back to black for unrecognized input', () => {
    expect(parseColor('not-a-color')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
  })
})
