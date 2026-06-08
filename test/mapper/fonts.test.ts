import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveAndLoadFonts, weightToStyle } from '../../src/mapper/fonts'
import type { IRFontRef } from '../../src/types/ir'

import { installMockFigma, type MockFigmaState, uninstallMockFigma } from './_mockFigma'

describe('weightToStyle', () => {
  it('maps the canonical CSS weights', () => {
    expect(weightToStyle(100, false)).toBe('Thin')
    expect(weightToStyle(300, false)).toBe('Light')
    expect(weightToStyle(400, false)).toBe('Regular')
    expect(weightToStyle(500, false)).toBe('Medium')
    expect(weightToStyle(600, false)).toBe('SemiBold')
    expect(weightToStyle(700, false)).toBe('Bold')
    expect(weightToStyle(900, false)).toBe('Black')
  })

  it('appends Italic suffix for italic styles', () => {
    expect(weightToStyle(400, true)).toBe('Italic')
    expect(weightToStyle(700, true)).toBe('Bold Italic')
  })
})

describe('resolveAndLoadFonts', () => {
  let state: MockFigmaState

  beforeEach(() => {
    state = installMockFigma({
      availableFonts: [
        { family: 'Inter', style: 'Regular' },
        { family: 'Inter', style: 'Bold' },
        { family: 'Roboto', style: 'Regular' }
      ]
    })
  })

  afterEach(() => {
    uninstallMockFigma()
  })

  it('resolves to the requested family + style when available', async () => {
    const ref: IRFontRef = { family: 'Inter', weight: 700, style: 'normal' }
    const resolved = await resolveAndLoadFonts([ref])

    const fn = resolved.get('Inter|700|normal')
    expect(fn).toEqual({ family: 'Inter', style: 'Bold' })
    expect(state.loadedFonts).toContainEqual({ family: 'Inter', style: 'Bold' })
  })

  it('falls back to family Regular when the weighted variant is missing', async () => {
    const ref: IRFontRef = { family: 'Roboto', weight: 700, style: 'normal' }
    const resolved = await resolveAndLoadFonts([ref])

    expect(resolved.get('Roboto|700|normal')).toEqual({
      family: 'Roboto',
      style: 'Regular'
    })
  })

  it('falls back to Inter when the requested family is missing entirely', async () => {
    const ref: IRFontRef = { family: 'NonexistentFont', weight: 700, style: 'normal' }
    const resolved = await resolveAndLoadFonts([ref])

    expect(resolved.get('NonexistentFont|700|normal')).toEqual({
      family: 'Inter',
      style: 'Bold'
    })
  })

  it('falls back to Inter Regular when nothing else matches', async () => {
    const ref: IRFontRef = {
      family: 'NonexistentFont',
      weight: 100,
      style: 'normal'
    }
    const resolved = await resolveAndLoadFonts([ref])

    expect(resolved.get('NonexistentFont|100|normal')).toEqual({
      family: 'Inter',
      style: 'Regular'
    })
  })

  it('matches Figma spaced style names (Inter "Semi Bold") for weight 600', async () => {
    // weightToStyle(600) emits the no-space "SemiBold", but Figma's
    // Inter ships "Semi Bold". The match must be space/case-insensitive
    // and resolve to Figma's exact spelling so loadFontAsync succeeds -
    // otherwise the title silently renders Regular.
    uninstallMockFigma()
    const local = installMockFigma({
      availableFonts: [
        { family: 'Inter', style: 'Regular' },
        { family: 'Inter', style: 'Semi Bold' },
        { family: 'Inter', style: 'Extra Bold' }
      ]
    })
    const refs: IRFontRef[] = [
      { family: 'Inter', weight: 600, style: 'normal' },
      { family: 'Inter', weight: 800, style: 'normal' }
    ]
    const resolved = await resolveAndLoadFonts(refs)

    expect(resolved.get('Inter|600|normal')).toEqual({
      family: 'Inter',
      style: 'Semi Bold'
    })
    expect(resolved.get('Inter|800|normal')).toEqual({
      family: 'Inter',
      style: 'Extra Bold'
    })
    expect(local.loadedFonts).toContainEqual({
      family: 'Inter',
      style: 'Semi Bold'
    })
  })

  it('deduplicates load calls for identical (family, style) pairs', async () => {
    const refs: IRFontRef[] = [
      { family: 'Inter', weight: 400, style: 'normal' },
      { family: 'Inter', weight: 400, style: 'normal' },
      { family: 'Inter', weight: 400, style: 'normal' }
    ]
    await resolveAndLoadFonts(refs)

    const interRegularCount = state.loadedFonts.filter(
      (f) => f.family === 'Inter' && f.style === 'Regular'
    ).length
    expect(interRegularCount).toBe(1)
  })
})
