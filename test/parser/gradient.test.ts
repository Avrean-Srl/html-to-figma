import { describe, expect, it } from 'vitest'

import { parseGradient } from '../../src/parser/gradient'

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
})
