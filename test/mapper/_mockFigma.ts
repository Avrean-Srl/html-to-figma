// Minimal figma global stub for mapper tests. Only stubs the surface
// the mapper actually touches: createFrame, createText, appendChild,
// resize, font loading, currentPage, viewport. Tests inspect the
// resulting node tree directly.

export interface MockNode {
  type: 'FRAME' | 'TEXT' | 'RECTANGLE'
  name: string
  x: number
  y: number
  width: number
  height: number
  opacity: number
  fills: unknown[]
  children: MockNode[]
  parent: MockNode | null
  resize: (w: number, h: number) => void
  appendChild: (child: MockNode) => void
  blendMode?: string
  effects?: unknown[]
  // Frame-only
  cornerRadius?: number
  topLeftRadius?: number
  topRightRadius?: number
  bottomRightRadius?: number
  bottomLeftRadius?: number
  clipsContent?: boolean
  strokes?: unknown[]
  strokeWeight?: number
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER'
  // Auto Layout
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL'
  primaryAxisSizingMode?: 'FIXED' | 'AUTO'
  counterAxisSizingMode?: 'FIXED' | 'AUTO'
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX'
  itemSpacing?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  layoutWrap?: 'WRAP' | 'NO_WRAP'
  // Text-only
  characters?: string
  fontName?: { family: string; style: string }
  fontSize?: number
  letterSpacing?: { value: number; unit: 'PIXELS' }
  lineHeight?: { value: number; unit: 'PIXELS' }
  textAlignHorizontal?: 'LEFT' | 'RIGHT' | 'CENTER' | 'JUSTIFIED'
  textDecoration?: 'UNDERLINE' | 'STRIKETHROUGH'
}

export interface MockFigmaState {
  loadedFonts: Array<{ family: string; style: string }>
  availableFonts: Array<{ fontName: { family: string; style: string } }>
  createdNodes: MockNode[]
  currentPageChildren: MockNode[]
  viewportCenter: { x: number; y: number }
}

// Approximate Figma's hug-snap behavior: when layoutMode flips from NONE
// to HORIZONTAL/VERTICAL and the matching sizing mode is still AUTO (the
// default), the frame shrinks to the content extent along that axis.
// Real Figma is more nuanced (it accounts for padding, gap, child layout
// sizing, etc.) but this is enough to catch a mapper that flips layoutMode
// before pinning sizing modes to FIXED.
function hugSnap(node: MockNode): void {
  if (node.layoutMode === 'NONE' || node.layoutMode === undefined) return
  const horizontal = node.layoutMode === 'HORIZONTAL'
  const padLeft = node.paddingLeft ?? 0
  const padRight = node.paddingRight ?? 0
  const padTop = node.paddingTop ?? 0
  const padBottom = node.paddingBottom ?? 0
  const gap = node.itemSpacing ?? 0
  const n = node.children.length
  const gaps = n > 1 ? (n - 1) * gap : 0

  if (horizontal) {
    const sumW = node.children.reduce((a, c) => a + c.width, 0)
    const maxH = node.children.reduce((a, c) => Math.max(a, c.height), 0)
    if (node.primaryAxisSizingMode === 'AUTO' || node.primaryAxisSizingMode === undefined) {
      node.width = sumW + gaps + padLeft + padRight
    }
    if (node.counterAxisSizingMode === 'AUTO' || node.counterAxisSizingMode === undefined) {
      node.height = maxH + padTop + padBottom
    }
  } else {
    const sumH = node.children.reduce((a, c) => a + c.height, 0)
    const maxW = node.children.reduce((a, c) => Math.max(a, c.width), 0)
    if (node.primaryAxisSizingMode === 'AUTO' || node.primaryAxisSizingMode === undefined) {
      node.height = sumH + gaps + padTop + padBottom
    }
    if (node.counterAxisSizingMode === 'AUTO' || node.counterAxisSizingMode === undefined) {
      node.width = maxW + padLeft + padRight
    }
  }
}

function makeNode(
  type: 'FRAME' | 'TEXT' | 'RECTANGLE',
  state: MockFigmaState
): MockNode {
  // Storage for layoutMode so we can intercept assignment and simulate
  // Figma's hug-snap.
  let layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' = 'NONE'

  const node: MockNode = {
    type,
    name: '',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    opacity: 1,
    fills: [],
    children: [],
    parent: null,
    resize(w, h) {
      this.width = w
      this.height = h
    },
    clipsContent: false,
    appendChild(child) {
      if (child.parent !== null) {
        const idx = child.parent.children.indexOf(child)
        if (idx >= 0) child.parent.children.splice(idx, 1)
      }
      child.parent = this
      this.children.push(child)
    }
  }

  Object.defineProperty(node, 'layoutMode', {
    enumerable: true,
    configurable: true,
    get() {
      return layoutMode
    },
    set(v: 'NONE' | 'HORIZONTAL' | 'VERTICAL') {
      const wasNone = layoutMode === 'NONE'
      layoutMode = v
      // Snap only on the NONE -> HORIZONTAL/VERTICAL transition. Mirrors
      // Figma: switching off doesn't snap; switching on does.
      if (wasNone && v !== 'NONE') {
        hugSnap(node)
      }
    }
  })

  state.createdNodes.push(node)
  return node
}

export function installMockFigma(
  options: Partial<{
    availableFonts: Array<{ family: string; style: string }>
    viewportCenter: { x: number; y: number }
  }> = {}
): MockFigmaState {
  const state: MockFigmaState = {
    loadedFonts: [],
    availableFonts: (
      options.availableFonts ?? [
        { family: 'Inter', style: 'Regular' },
        { family: 'Inter', style: 'Bold' },
        { family: 'Inter', style: 'Italic' }
      ]
    ).map((fn) => ({ fontName: fn })),
    createdNodes: [],
    currentPageChildren: [],
    viewportCenter: options.viewportCenter ?? { x: 0, y: 0 }
  }

  let nextImageHash = 0
  const figmaMock = {
    createFrame: () => makeNode('FRAME', state),
    createText: () => makeNode('TEXT', state),
    createRectangle: () => makeNode('RECTANGLE', state),
    createImage: (_bytes: Uint8Array) => ({ hash: `img-${nextImageHash++}` }),
    createNodeFromSvg: (_svg: string) => makeNode('FRAME', state),
    loadFontAsync: async (fontName: { family: string; style: string }) => {
      state.loadedFonts.push(fontName)
    },
    listAvailableFontsAsync: async () => state.availableFonts,
    currentPage: {
      appendChild: (child: MockNode) => {
        if (child.parent) {
          const idx = child.parent.children.indexOf(child)
          if (idx >= 0) child.parent.children.splice(idx, 1)
        }
        child.parent = null
        state.currentPageChildren.push(child)
      },
      selection: [] as MockNode[]
    },
    viewport: {
      get center() {
        return state.viewportCenter
      },
      scrollAndZoomIntoView: () => {}
    }
  }

  ;(globalThis as unknown as { figma: unknown }).figma = figmaMock
  return state
}

export function uninstallMockFigma(): void {
  delete (globalThis as unknown as { figma?: unknown }).figma
}
