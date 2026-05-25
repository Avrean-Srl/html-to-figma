import { describe, expect, it } from 'vitest'

import { fillToPaint } from '../../src/mapper/paint'
import type { IRFill } from '../../src/types/ir'

describe('fillToPaint', () => {
  it('maps solid fill to SOLID with separate opacity', () => {
    const fill: IRFill = {
      type: 'solid',
      color: { r: 1, g: 0, b: 0.5, a: 0.7 }
    }
    const paint = fillToPaint(fill)
    expect(paint.type).toBe('SOLID')
    if (paint.type === 'SOLID') {
      expect(paint.color).toEqual({ r: 1, g: 0, b: 0.5 })
      expect(paint.opacity).toBeCloseTo(0.7)
    }
  })

  it('maps linear gradient to GRADIENT_LINEAR with stops and transform', () => {
    const fill: IRFill = {
      type: 'gradient',
      gradient: {
        kind: 'linear',
        angle: 90,
        stops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
        ]
      }
    }
    const paint = fillToPaint(fill)
    expect(paint.type).toBe('GRADIENT_LINEAR')
    if (paint.type === 'GRADIENT_LINEAR') {
      expect(paint.gradientStops).toHaveLength(2)
      expect(paint.gradientStops[0].position).toBe(0)
      expect(paint.gradientStops[1].position).toBe(1)
      // 90deg = identity (LTR). Transform should be close to identity.
      const t = paint.gradientTransform
      expect(t[0][0]).toBeCloseTo(1, 5)
      expect(t[1][1]).toBeCloseTo(1, 5)
      expect(t[0][1]).toBeCloseTo(0, 5)
      expect(t[1][0]).toBeCloseTo(0, 5)
    }
  })

  it('rotates linear-gradient 180deg to point downward', () => {
    const fill: IRFill = {
      type: 'gradient',
      gradient: {
        kind: 'linear',
        angle: 180,
        stops: [
          { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }
        ]
      }
    }
    const paint = fillToPaint(fill)
    if (paint.type !== 'GRADIENT_LINEAR') throw new Error('expected linear')
    const t = paint.gradientTransform
    // CSS 180deg -> Figma rotation of +90 around center
    // Verified earlier: matrix is [[0, -1, 1], [1, 0, 0]]
    expect(t[0][0]).toBeCloseTo(0, 5)
    expect(t[0][1]).toBeCloseTo(-1, 5)
    expect(t[0][2]).toBeCloseTo(1, 5)
    expect(t[1][0]).toBeCloseTo(1, 5)
    expect(t[1][1]).toBeCloseTo(0, 5)
    expect(t[1][2]).toBeCloseTo(0, 5)
  })

  it('maps radial to GRADIENT_RADIAL with scale-√2 transform', () => {
    const fill: IRFill = {
      type: 'gradient',
      gradient: {
        kind: 'radial',
        angle: 0,
        stops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
        ]
      }
    }
    const paint = fillToPaint(fill)
    expect(paint.type).toBe('GRADIENT_RADIAL')
    if (paint.type === 'GRADIENT_RADIAL') {
      const t = paint.gradientTransform
      expect(t[0][0]).toBeCloseTo(Math.SQRT2, 5)
      expect(t[1][1]).toBeCloseTo(Math.SQRT2, 5)
    }
  })
})
