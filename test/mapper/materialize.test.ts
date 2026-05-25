import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { materializeIR } from '../../src/mapper'
import type { IRDocument, IRFrame, IRText } from '../../src/types/ir'

import { installMockFigma, type MockFigmaState, uninstallMockFigma } from './_mockFigma'

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
    characters: 'Hello',
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

describe('materializeIR', () => {
  let state: MockFigmaState

  beforeEach(() => {
    state = installMockFigma()
  })

  afterEach(() => {
    uninstallMockFigma()
  })

  it('creates a root FrameNode with the IR layout', async () => {
    const doc = makeDoc(
      frame({ layout: { x: 0, y: 0, width: 1440, height: 500 } })
    )
    const result = await materializeIR(doc)

    expect(result.root.type).toBe('FRAME')
    expect(result.root.width).toBe(1440)
    expect(result.root.height).toBe(500)
    expect(result.nodesCreated).toBe(1)
  })

  it('nests child frames inside the parent and converts to parent-relative coords', async () => {
    const doc = makeDoc(
      frame({
        layout: { x: 0, y: 0, width: 1440, height: 500 },
        children: [
          frame({
            id: 'inner',
            layout: { x: 50, y: 30, width: 200, height: 100 }
          })
        ]
      })
    )
    const result = await materializeIR(doc)

    expect(result.root.children).toHaveLength(1)
    const inner = result.root.children[0]
    expect(inner.x).toBe(50)
    expect(inner.y).toBe(30)
    expect(result.nodesCreated).toBe(2)
  })

  it('uses parent-relative coords when the parent itself is offset', async () => {
    const doc = makeDoc(
      frame({
        layout: { x: 0, y: 0, width: 1440, height: 500 },
        children: [
          frame({
            id: 'outer',
            layout: { x: 100, y: 50, width: 800, height: 400 },
            children: [
              frame({
                id: 'inner',
                layout: { x: 150, y: 80, width: 200, height: 100 }
              })
            ]
          })
        ]
      })
    )
    const result = await materializeIR(doc)

    const outer = result.root.children[0]
    const inner = outer.children[0]
    expect(outer.x).toBe(100)
    expect(outer.y).toBe(50)
    // inner at container (150, 80) inside outer at container (100, 50) → relative (50, 30)
    expect(inner.x).toBe(50)
    expect(inner.y).toBe(30)
  })

  it('creates TextNodes from IRText children with font + characters in correct order', async () => {
    const doc: IRDocument = {
      viewportWidth: 1440,
      root: frame({
        children: [text({ characters: 'Hello world', fontSize: 18 })]
      }),
      fontsUsed: [{ family: 'Inter', weight: 400, style: 'normal' }],
      imageFailures: []
    }
    const result = await materializeIR(doc)

    expect(result.root.children).toHaveLength(1)
    const t = result.root.children[0]
    expect(t.type).toBe('TEXT')
    expect(t.characters).toBe('Hello world')
    expect(t.fontSize).toBe(18)
    expect(t.fontName).toEqual({ family: 'Inter', style: 'Regular' })
  })

  it('applies background fills in 0-1 channels with alpha', async () => {
    const doc = makeDoc(
      frame({
        fills: [{ type: 'solid', color: { r: 1, g: 0, b: 0, a: 0.5 } }]
      })
    )
    const result = await materializeIR(doc)

    expect(result.root.fills).toEqual([
      { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 0.5 }
    ])
  })

  it('emits progress callbacks at the fonts and nodes stages', async () => {
    const events: Array<[string, number, number]> = []
    const doc = makeDoc(
      frame({
        children: [text({ id: 'a' }), text({ id: 'b' })]
      })
    )
    await materializeIR(doc, {
      onProgress: (stage, current, total) => events.push([stage, current, total])
    })

    const stages = events.map((e) => e[0])
    expect(stages).toContain('fonts')
    expect(stages).toContain('nodes')
    expect(stages).toContain('done')
    // The final event reports nodes equal to total.
    const last = events[events.length - 1]
    expect(last[0]).toBe('done')
    expect(last[1]).toBe(last[2])
  })

  it('loads only unique fonts before materializing', async () => {
    const doc: IRDocument = {
      viewportWidth: 1440,
      root: frame({
        children: [
          text({ characters: 'A', fontWeight: 400 }),
          text({ characters: 'B', fontWeight: 700 }),
          text({ characters: 'C', fontWeight: 400 })
        ]
      }),
      fontsUsed: [
        { family: 'Inter', weight: 400, style: 'normal' },
        { family: 'Inter', weight: 700, style: 'normal' }
      ],
      imageFailures: []
    }
    await materializeIR(doc)

    const interStyles = state.loadedFonts
      .filter((f) => f.family === 'Inter')
      .map((f) => f.style)
    expect(new Set(interStyles)).toEqual(new Set(['Regular', 'Bold']))
  })
})
