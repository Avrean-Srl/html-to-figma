import { describe, expect, it } from 'vitest'

import { parseBoxShadow } from '../../src/parser/shadow'

describe('parseBoxShadow', () => {
  it('returns empty array for none or empty', () => {
    expect(parseBoxShadow('none')).toEqual([])
    expect(parseBoxShadow('')).toEqual([])
  })

  it('parses a single drop shadow with color-first form', () => {
    const result = parseBoxShadow('rgba(0, 0, 0, 0.1) 0px 4px 6px 0px')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('drop')
    expect(result[0].offsetX).toBe(0)
    expect(result[0].offsetY).toBe(4)
    expect(result[0].blur).toBe(6)
    expect(result[0].spread).toBe(0)
    expect(result[0].color.a).toBeCloseTo(0.1, 2)
  })

  it('parses inset shadows', () => {
    const result = parseBoxShadow('inset rgb(0, 0, 0) 0px 1px 2px')
    expect(result[0].type).toBe('inner')
  })

  it('parses multiple comma-separated shadows', () => {
    const result = parseBoxShadow(
      'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.06) 0px 1px 2px 0px'
    )
    expect(result).toHaveLength(2)
    expect(result[0].blur).toBe(3)
    expect(result[1].blur).toBe(2)
  })

  it('handles missing blur and spread (defaults to 0)', () => {
    const result = parseBoxShadow('rgb(0, 0, 0) 1px 2px')
    expect(result[0].blur).toBe(0)
    expect(result[0].spread).toBe(0)
  })

  it('handles negative offsets and spread', () => {
    const result = parseBoxShadow('rgba(0, 0, 0, 1) -2px -4px 8px -1px')
    expect(result[0].offsetX).toBe(-2)
    expect(result[0].offsetY).toBe(-4)
    expect(result[0].spread).toBe(-1)
  })
})
