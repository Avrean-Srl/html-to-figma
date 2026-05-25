import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { materializeIR } from '../../src/mapper'
import type { IRDocument, IRFrame, IRText } from '../../src/types/ir'

import { installMockFigma, uninstallMockFigma } from './_mockFigma'

function frame(overrides: Partial<IRFrame> = {}): IRFrame {
  return {
    type: 'frame',
    id: 'f',
    layout: { x: 0, y: 0, width: 100, height: 100 },
    opacity: 1,
    hidden: false,
    blendMode: 'normal',
    zIndex: 0,
    sourceTag: 'div',
    fills: [],
    cornerRadius: [0, 0, 0, 0],
    children: [],
    autoLayout: null,
    shadows: [],
    stroke: null,
    clipsContent: false,
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
    zIndex: 0,
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
  return { viewportWidth: 1440, root, fontsUsed: [], imageFailures: [] }
}

describe('z-index ordering and clipsContent', () => {
  beforeEach(() => {
    installMockFigma()
  })
  afterEach(() => {
    uninstallMockFigma()
  })

  it('sorts children by ascending z-index when parent has no auto-layout', async () => {
    const doc = makeDoc(
      frame({
        children: [
          text({ id: 'mid', characters: 'mid', zIndex: 5 }),
          text({ id: 'top', characters: 'top', zIndex: 10 }),
          text({ id: 'bot', characters: 'bot', zIndex: 0 })
        ]
      })
    )
    const result = await materializeIR(doc)
    // Figma children: ascending order so the last entry is on top.
    const chars = result.root.children.map((c) => c.characters)
    expect(chars).toEqual(['bot', 'mid', 'top'])
  })

  it('preserves source order for ties (stable sort)', async () => {
    const doc = makeDoc(
      frame({
        children: [
          text({ id: 'a', characters: 'a', zIndex: 0 }),
          text({ id: 'b', characters: 'b', zIndex: 0 }),
          text({ id: 'c', characters: 'c', zIndex: 0 })
        ]
      })
    )
    const result = await materializeIR(doc)
    const chars = result.root.children.map((c) => c.characters)
    expect(chars).toEqual(['a', 'b', 'c'])
  })

  it('does NOT reorder when parent has Auto Layout (Figma owns layout)', async () => {
    const doc = makeDoc(
      frame({
        autoLayout: {
          direction: 'horizontal',
          gap: 0,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          primaryAxisAlign: 'min',
          counterAxisAlign: 'min',
          wrap: false
        },
        children: [
          text({ id: 'a', characters: 'a', zIndex: 99 }),
          text({ id: 'b', characters: 'b', zIndex: 0 }),
          text({ id: 'c', characters: 'c', zIndex: 50 })
        ]
      })
    )
    const result = await materializeIR(doc)
    const chars = result.root.children.map((c) => c.characters)
    // Original order preserved despite z-index values.
    expect(chars).toEqual(['a', 'b', 'c'])
  })

  it('applies clipsContent on frames', async () => {
    const doc = makeDoc(frame({ clipsContent: true }))
    const result = await materializeIR(doc)
    expect(result.root.clipsContent).toBe(true)
  })

  it('defaults clipsContent to false', async () => {
    const doc = makeDoc(frame({}))
    const result = await materializeIR(doc)
    expect(result.root.clipsContent).toBe(false)
  })
})
