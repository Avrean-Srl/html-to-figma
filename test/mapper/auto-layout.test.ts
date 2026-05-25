import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { materializeIR } from '../../src/mapper'
import type { IRAutoLayout, IRDocument, IRFrame, IRText } from '../../src/types/ir'

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

function autoLayout(overrides: Partial<IRAutoLayout> = {}): IRAutoLayout {
  return {
    direction: 'horizontal',
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    primaryAxisAlign: 'min',
    counterAxisAlign: 'min',
    wrap: false,
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

describe('materializeIR with Auto Layout', () => {
  let state: MockFigmaState

  beforeEach(() => {
    state = installMockFigma()
  })

  afterEach(() => {
    uninstallMockFigma()
  })

  it('applies layoutMode HORIZONTAL for horizontal auto-layout', async () => {
    const doc = makeDoc(
      frame({ autoLayout: autoLayout({ direction: 'horizontal' }) })
    )
    const result = await materializeIR(doc)
    expect(result.root.layoutMode).toBe('HORIZONTAL')
  })

  it('applies layoutMode VERTICAL for vertical auto-layout', async () => {
    const doc = makeDoc(
      frame({ autoLayout: autoLayout({ direction: 'vertical' }) })
    )
    const result = await materializeIR(doc)
    expect(result.root.layoutMode).toBe('VERTICAL')
  })

  it('passes through itemSpacing, padding, and align to Figma', async () => {
    const doc = makeDoc(
      frame({
        autoLayout: autoLayout({
          gap: 24,
          padding: { top: 8, right: 16, bottom: 24, left: 32 },
          primaryAxisAlign: 'space-between',
          counterAxisAlign: 'center'
        })
      })
    )
    const result = await materializeIR(doc)
    expect(result.root.itemSpacing).toBe(24)
    expect(result.root.paddingTop).toBe(8)
    expect(result.root.paddingRight).toBe(16)
    expect(result.root.paddingBottom).toBe(24)
    expect(result.root.paddingLeft).toBe(32)
    expect(result.root.primaryAxisAlignItems).toBe('SPACE_BETWEEN')
    expect(result.root.counterAxisAlignItems).toBe('CENTER')
  })

  it('forces sizing modes to FIXED to preserve measured dimensions', async () => {
    const doc = makeDoc(
      frame({
        layout: { x: 0, y: 0, width: 800, height: 200 },
        autoLayout: autoLayout()
      })
    )
    const result = await materializeIR(doc)
    expect(result.root.primaryAxisSizingMode).toBe('FIXED')
    expect(result.root.counterAxisSizingMode).toBe('FIXED')
    expect(result.root.width).toBe(800)
    expect(result.root.height).toBe(200)
  })

  // Regression for saas-landing.html report: a horizontal flex container
  // (e.g. a `<nav>` with `justify-content: space-between`) was getting
  // hug-snapped to the sum of its children when layoutMode flipped before
  // sizing modes were pinned to FIXED. The fix is to pin sizing first and
  // call resize() defensively at the end of applyAutoLayout.
  it('preserves frame width when children hug-content is much smaller (was: nav shrank to 393)', async () => {
    const doc = makeDoc(
      frame({
        layout: { x: 0, y: 0, width: 1088, height: 74 },
        autoLayout: autoLayout({
          direction: 'horizontal',
          primaryAxisAlign: 'space-between',
          counterAxisAlign: 'center',
          padding: { top: 20, right: 0, bottom: 20, left: 0 }
        }),
        children: [
          frame({
            id: 'logo-group',
            layout: { x: 0, y: 0, width: 104, height: 28 }
          }),
          frame({
            id: 'links-group',
            layout: { x: 0, y: 0, width: 289, height: 34 }
          })
        ]
      })
    )
    const result = await materializeIR(doc)
    // Pre-fix the mock would report 104 + 289 + 0 = 393.
    expect(result.root.width).toBe(1088)
    expect(result.root.height).toBe(74)
    expect(result.root.layoutMode).toBe('HORIZONTAL')
    expect(result.root.primaryAxisAlignItems).toBe('SPACE_BETWEEN')
  })

  it('preserves frame width on a vertical-direction container too (parity check)', async () => {
    const doc = makeDoc(
      frame({
        layout: { x: 0, y: 0, width: 1152, height: 600 },
        autoLayout: autoLayout({
          direction: 'vertical',
          gap: 24
        }),
        children: [
          frame({
            id: 'r1',
            layout: { x: 0, y: 0, width: 200, height: 100 }
          }),
          frame({
            id: 'r2',
            layout: { x: 0, y: 0, width: 300, height: 100 }
          })
        ]
      })
    )
    const result = await materializeIR(doc)
    expect(result.root.width).toBe(1152)
    expect(result.root.height).toBe(600)
  })

  it('enables layoutWrap when wrap is true', async () => {
    const doc = makeDoc(
      frame({ autoLayout: autoLayout({ wrap: true }) })
    )
    const result = await materializeIR(doc)
    expect(result.root.layoutWrap).toBe('WRAP')
  })

  it('does NOT set x/y on children of an auto-layout frame', async () => {
    const doc = makeDoc(
      frame({
        layout: { x: 0, y: 0, width: 1000, height: 100 },
        autoLayout: autoLayout({ direction: 'horizontal', gap: 16 }),
        children: [
          text({
            id: 'a',
            layout: { x: 50, y: 30, width: 100, height: 20 },
            characters: 'A'
          }),
          text({
            id: 'b',
            layout: { x: 200, y: 30, width: 100, height: 20 },
            characters: 'B'
          })
        ]
      })
    )
    const result = await materializeIR(doc)
    // x/y left at default 0 because Auto Layout positions them.
    expect(result.root.children[0].x).toBe(0)
    expect(result.root.children[0].y).toBe(0)
    expect(result.root.children[1].x).toBe(0)
    expect(result.root.children[1].y).toBe(0)
  })

  it('still sets x/y on children when parent has no auto-layout', async () => {
    const doc = makeDoc(
      frame({
        layout: { x: 0, y: 0, width: 1000, height: 100 },
        autoLayout: null,
        children: [
          text({
            id: 'a',
            layout: { x: 50, y: 30, width: 100, height: 20 },
            characters: 'A'
          })
        ]
      })
    )
    const result = await materializeIR(doc)
    expect(result.root.children[0].x).toBe(50)
    expect(result.root.children[0].y).toBe(30)
  })
})
