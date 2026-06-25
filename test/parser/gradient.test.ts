import { describe, expect, it } from 'vitest'

import { parseGradient, parseGradients } from '../../src/parser/gradient'

describe('parseGradient', () => {
  it('returns null for none and unrelated values', () => {
    expect(parseGradient('none')).toBeNull()
    expect(parseGradient('url(foo.png)')).toBeNull()
    expect(parseGradient('')).toBeNull()
  })

  it('parses linear-gradient with default direction (to bottom = 180deg)', () => {
    const g = parseGradient('linear-gradient(red, blue)')
    expect(g).not.toBeNull()
    expect(g?.kind).toBe('linear')
    expect(g?.angle).toBe(180)
    expect(g?.stops).toHaveLength(2)
    expect(g?.stops[0].position).toBe(0)
    expect(g?.stops[1].position).toBe(1)
  })

  it('parses explicit angle in deg', () => {
    expect(parseGradient('linear-gradient(135deg, red, blue)')?.angle).toBe(135)
    expect(parseGradient('linear-gradient(45deg, red, blue)')?.angle).toBe(45)
  })

  it('parses "to <direction>" keywords', () => {
    expect(parseGradient('linear-gradient(to top, red, blue)')?.angle).toBe(0)
    expect(parseGradient('linear-gradient(to right, red, blue)')?.angle).toBe(90)
    expect(parseGradient('linear-gradient(to bottom, red, blue)')?.angle).toBe(180)
    expect(parseGradient('linear-gradient(to left, red, blue)')?.angle).toBe(270)
    expect(parseGradient('linear-gradient(to top right, red, blue)')?.angle).toBe(45)
  })

  it('parses turn / rad / grad angle units', () => {
    expect(parseGradient('linear-gradient(0.5turn, red, blue)')?.angle).toBe(180)
    expect(parseGradient('linear-gradient(100grad, red, blue)')?.angle).toBeCloseTo(90, 5)
  })

  it('parses explicit stop positions in %', () => {
    const g = parseGradient('linear-gradient(red 10%, blue 90%)')
    expect(g?.stops[0].position).toBeCloseTo(0.1)
    expect(g?.stops[1].position).toBeCloseTo(0.9)
  })

  it('interpolates intermediate unspecified positions', () => {
    const g = parseGradient('linear-gradient(red, green, blue)')
    expect(g?.stops.map((s) => s.position)).toEqual([0, 0.5, 1])
  })

  it('parses rgba() stops with commas inside', () => {
    const g = parseGradient(
      'linear-gradient(rgba(255, 0, 0, 0.5), rgba(0, 0, 255, 1))'
    )
    expect(g?.stops).toHaveLength(2)
    expect(g?.stops[0].color.a).toBeCloseTo(0.5)
    expect(g?.stops[1].color.b).toBe(1)
  })

  it('parses radial-gradient', () => {
    const g = parseGradient('radial-gradient(red, blue)')
    expect(g?.kind).toBe('radial')
    expect(g?.stops).toHaveLength(2)
  })

  it('parses radial-gradient with shape/size descriptor as first arg', () => {
    const g = parseGradient('radial-gradient(circle, red, blue)')
    expect(g?.kind).toBe('radial')
    expect(g?.stops).toHaveLength(2)
  })

  it('returns null for malformed gradients', () => {
    expect(parseGradient('linear-gradient(red)')).toBeNull()
    expect(parseGradient('linear-gradient()')).toBeNull()
  })

  it('gives a transparent stop the RGB of its opaque neighbour (CSS premultiplied fade)', () => {
    // .cert__head: green paper fading to `transparent` (= rgba(0,0,0,0)).
    // Figma interpolates straight RGBA, so the black would muddy the
    // fade. The transparent stop must inherit the green RGB, alpha 0.
    const g = parseGradient(
      'linear-gradient(180deg, rgb(220, 246, 230) 0%, rgba(0, 0, 0, 0) 100%)'
    )
    expect(g?.stops).toHaveLength(2)
    expect(g?.stops[1].color.a).toBe(0)
    expect(g?.stops[1].color.r).toBeCloseTo(220 / 255, 4)
    expect(g?.stops[1].color.g).toBeCloseTo(246 / 255, 4)
    expect(g?.stops[1].color.b).toBeCloseTo(230 / 255, 4)
  })

  it('leaves a genuine black-to-transparent-black fade alone', () => {
    // `linear-gradient(black, transparent)` should still fade black out:
    // the transparent stop inherits black (its only opaque neighbour).
    const g = parseGradient('linear-gradient(rgb(0, 0, 0), rgba(0, 0, 0, 0))')
    expect(g?.stops[1].color).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('clamps out-of-range stop positions into [0, 1] (Figma requires it)', () => {
    // CSS permits positions outside 0-100%; Figma's set_fills rejects them.
    const g = parseGradient('linear-gradient(red -20%, blue 150%)')
    expect(g?.stops[0].position).toBe(0)
    expect(g?.stops[1].position).toBe(1)
    expect(g?.stops.every((s) => s.position >= 0 && s.position <= 1)).toBe(true)
  })

  it('keeps stop positions non-decreasing after clamping', () => {
    const g = parseGradient('linear-gradient(red 80%, green 30%, blue 120%)')
    const positions = g?.stops.map((s) => s.position) ?? []
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1])
    }
    expect(positions.every((p) => p >= 0 && p <= 1)).toBe(true)
  })

  it('keeps an all-transparent gradient untouched', () => {
    const g = parseGradient(
      'linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, 0))'
    )
    expect(g?.stops.every((s) => s.color.a === 0)).toBe(true)
  })
})

describe('parseGradients (multi-background)', () => {
  it('returns empty array for none, url, and empty input', () => {
    expect(parseGradients('none')).toEqual([])
    expect(parseGradients('')).toEqual([])
    expect(parseGradients('url(foo.png)')).toEqual([])
  })

  it('wraps a single gradient in a length-1 array', () => {
    const out = parseGradients('linear-gradient(red, blue)')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('linear')
  })

  it('parses three stacked backgrounds in source order', () => {
    // Mirrors the saas-landing hero-bg value Chrome returns from
    // getComputedStyle.
    const value =
      'radial-gradient(circle at 30% 20%, rgba(124, 58, 237, 0.18), transparent 60%), ' +
      'radial-gradient(circle at 80% 0%, rgba(16, 185, 129, 0.15), transparent 55%), ' +
      'linear-gradient(180deg, rgb(250, 251, 255) 0%, rgb(255, 255, 255) 100%)'
    const out = parseGradients(value)
    expect(out).toHaveLength(3)
    expect(out[0].kind).toBe('radial')
    expect(out[1].kind).toBe('radial')
    expect(out[2].kind).toBe('linear')
    expect(out[2].angle).toBe(180)
    // The first radial must have a real pink first stop, not the
    // corrupt black fallback the old single-gradient regex produced.
    expect(out[0].stops[0].color.r).toBeCloseTo(124 / 255, 2)
    expect(out[0].stops[0].color.g).toBeCloseTo(58 / 255, 2)
    expect(out[0].stops[0].color.b).toBeCloseTo(237 / 255, 2)
    expect(out[0].stops[0].color.a).toBeCloseTo(0.18, 2)
    // Its second stop should be transparent at position 0.6.
    expect(out[0].stops[1].color.a).toBeCloseTo(0, 2)
    expect(out[0].stops[1].position).toBeCloseTo(0.6, 2)
  })

  it('skips non-gradient layers (url images) and returns only gradients', () => {
    const value =
      'url("foo.png"), linear-gradient(90deg, red, blue)'
    const out = parseGradients(value)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('linear')
    expect(out[0].angle).toBe(90)
  })
})
