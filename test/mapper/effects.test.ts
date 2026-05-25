import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { materializeIR } from '../../src/mapper'
import type {
  IRDocument,
  IRFrame,
  IRShadow,
  IRStroke,
  IRText
} from '../../src/types/ir'

import { installMockFigma, type MockFigmaState, uninstallMockFigma } from './_mockFigma'

function frame(overrides: Partial<IRFrame> = {}): IRFrame {
  return {
    type: 'frame',
    id: 'f',
    layout: { x: 0, y: 0, width: 100, height: 100 },
    opacity: 1,
    hidden: false,
    blendMode: 'normal',
    sourceTag: 'div',
    fills: [],
    cornerRadius: [0, 0, 0, 0],
    children: [],
    autoLayout: null,
    shadows: [],
    stroke: null,
    ...overrides
  }
}

function text(overrides: Partial<IRText> = {}): IRText {
  return {
    type: 'text',
    id: 't',
    layout: { x: 0, y: 0, width: 100, height: 20 },
    opacity: 1,
    hidden: false,
    blendMode: 'normal',
    characters: 'X',
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: 400,
    fontStyle: 'normal',
    color: { r: 0, g: 0, b: 0, a: 1 },
    letterSpacing: 0,
    lineHeight: 20,
    textAlign: 'left',
    textDecoration: 'none',
    ...overrides
  }
}

function makeDoc(root: IRFrame): IRDocument {
  return {
    viewportWidth: 1440,
    root,
    fontsUsed: [],
    imageFailures: []
  }
}

describe('mapper effects, stroke, blendMode', () => {
  let _state: MockFigmaState

  beforeEach(() => {
    _state = installMockFigma()
  })

  afterEach(() => {
    uninstallMockFigma()
  })

  it('applies a drop shadow as Effect with DROP_SHADOW type', async () => {
    const shadow: IRShadow = {
      type: 'drop',
      offsetX: 0,
      offsetY: 4,
      blur: 6,
      spread: 0,
      color: { r: 0, g: 0, b: 0, a: 0.1 }
    }
    const doc = makeDoc(frame({ shadows: [shadow] }))
    const result = await materializeIR(doc)

    expect(result.root.effects).toHaveLength(1)
    const eff = (result.root.effects as Effect[])[0] as DropShadowEffect
    expect(eff.type).toBe('DROP_SHADOW')
    expect(eff.offset).toEqual({ x: 0, y: 4 })
    expect(eff.radius).toBe(6)
  })

  it('applies inset shadows as INNER_SHADOW', async () => {
    const shadow: IRShadow = {
      type: 'inner',
      offsetX: 0,
      offsetY: 1,
      blur: 2,
      spread: 0,
      color: { r: 0, g: 0, b: 0, a: 0.5 }
    }
    const doc = makeDoc(frame({ shadows: [shadow] }))
    const result = await materializeIR(doc)

    const eff = (result.root.effects as Effect[])[0]
    expect(eff.type).toBe('INNER_SHADOW')
  })

  it('applies multiple shadows in order', async () => {
    const shadows: IRShadow[] = [
      {
        type: 'drop',
        offsetX: 0,
        offsetY: 1,
        blur: 3,
        spread: 0,
        color: { r: 0, g: 0, b: 0, a: 0.1 }
      },
      {
        type: 'drop',
        offsetX: 0,
        offsetY: 1,
        blur: 2,
        spread: 0,
        color: { r: 0, g: 0, b: 0, a: 0.06 }
      }
    ]
    const doc = makeDoc(frame({ shadows }))
    const result = await materializeIR(doc)
    expect(result.root.effects).toHaveLength(2)
  })

  it('applies a uniform border as INSIDE stroke', async () => {
    const stroke: IRStroke = {
      width: 2,
      color: { r: 1, g: 0, b: 0, a: 1 }
    }
    const doc = makeDoc(frame({ stroke }))
    const result = await materializeIR(doc)

    expect(result.root.strokes).toHaveLength(1)
    expect(result.root.strokeWeight).toBe(2)
    expect(result.root.strokeAlign).toBe('INSIDE')
  })

  it('skips blendMode assignment for normal (preserves Figma default)', async () => {
    const doc = makeDoc(frame({ blendMode: 'normal' }))
    const result = await materializeIR(doc)
    expect(result.root.blendMode).toBeUndefined()
  })

  it('maps non-normal blendMode to Figma uppercase', async () => {
    const doc = makeDoc(frame({ blendMode: 'multiply' }))
    const result = await materializeIR(doc)
    expect(result.root.blendMode).toBe('MULTIPLY')
  })

  it('applies blendMode on text nodes too', async () => {
    const doc: IRDocument = {
      viewportWidth: 1440,
      root: frame({
        children: [text({ blendMode: 'difference' })]
      }),
      fontsUsed: [],
      imageFailures: []
    }
    const result = await materializeIR(doc)
    const t = result.root.children[0]
    expect(t.blendMode).toBe('DIFFERENCE')
  })
})
