// Minimal figma global stub for mapper tests. Only stubs the surface
// the mapper actually touches: createFrame, createText, appendChild,
// resize, font loading, currentPage, viewport. Tests inspect the
// resulting node tree directly.

export interface MockNode {
  type: 'FRAME' | 'TEXT'
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
  // Frame-only
  cornerRadius?: number
  topLeftRadius?: number
  topRightRadius?: number
  bottomRightRadius?: number
  bottomLeftRadius?: number
  clipsContent?: boolean
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

function makeNode(type: 'FRAME' | 'TEXT', state: MockFigmaState): MockNode {
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
    appendChild(child) {
      if (child.parent !== null) {
        const idx = child.parent.children.indexOf(child)
        if (idx >= 0) child.parent.children.splice(idx, 1)
      }
      child.parent = this
      this.children.push(child)
    }
  }
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

  const figmaMock = {
    createFrame: () => makeNode('FRAME', state),
    createText: () => makeNode('TEXT', state),
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
