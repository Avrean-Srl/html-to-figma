import type { IRDocument, IRFrame, IRImage, IRNode, IRSvg, IRText } from '../types/ir'

import { applyAutoLayout } from './auto-layout'
import { createFrameFromIR } from './frame'
import { resolveAndLoadFonts, resolveFont } from './fonts'
import { createImageFromIR } from './image'
import { createSvgFromIR } from './svg'
import { createTextFromIR } from './text'

export interface MaterializeResult {
  root: FrameNode
  nodesCreated: number
}

export interface MaterializeOptions {
  onProgress?: (
    stage: 'fonts' | 'nodes' | 'done',
    current: number,
    total: number
  ) => void
}

function countIRNodes(node: import('../types/ir').IRNode): number {
  if (node.type !== 'frame') return 1
  let total = 1
  for (const child of node.children) total += countIRNodes(child)
  return total
}

export async function materializeIR(
  doc: IRDocument,
  options: MaterializeOptions = {}
): Promise<MaterializeResult> {
  const onProgress = options.onProgress

  onProgress?.('fonts', 0, doc.fontsUsed.length || 1)
  const fontMap = await resolveAndLoadFonts(doc.fontsUsed)
  onProgress?.('fonts', doc.fontsUsed.length || 1, doc.fontsUsed.length || 1)

  const totalNodes = countIRNodes(doc.root)
  onProgress?.('nodes', 0, totalNodes)

  let nodesCreated = 0
  // Emit progress every N nodes to avoid spamming the event bus on
  // large imports. Final tick is forced when the build completes.
  const PROGRESS_CHUNK = 25
  function tickProgress(): void {
    if (nodesCreated % PROGRESS_CHUNK === 0) {
      onProgress?.('nodes', nodesCreated, totalNodes)
    }
  }

  function buildNode(
    ir: IRNode,
    parentX: number,
    parentY: number,
    parentHasAutoLayout: boolean
  ): SceneNode | null {
    if (ir.type === 'frame') {
      return buildFrame(ir, parentX, parentY, parentHasAutoLayout)
    }
    if (ir.type === 'text') {
      return buildText(ir, parentX, parentY, parentHasAutoLayout)
    }
    if (ir.type === 'image') {
      return buildImage(ir, parentX, parentY, parentHasAutoLayout)
    }
    if (ir.type === 'svg') {
      return buildSvg(ir, parentX, parentY, parentHasAutoLayout)
    }
    return null
  }

  function buildImage(
    ir: IRImage,
    parentX: number,
    parentY: number,
    parentHasAutoLayout: boolean
  ): RectangleNode {
    const node = createImageFromIR(ir)
    if (!parentHasAutoLayout) {
      node.x = ir.layout.x - parentX
      node.y = ir.layout.y - parentY
    }
    nodesCreated++
    tickProgress()
    return node
  }

  function buildSvg(
    ir: IRSvg,
    parentX: number,
    parentY: number,
    parentHasAutoLayout: boolean
  ): FrameNode {
    const node = createSvgFromIR(ir)
    if (!parentHasAutoLayout) {
      node.x = ir.layout.x - parentX
      node.y = ir.layout.y - parentY
    }
    nodesCreated++
    tickProgress()
    return node
  }

  function buildFrame(
    ir: IRFrame,
    parentX: number,
    parentY: number,
    parentHasAutoLayout: boolean
  ): FrameNode {
    const frame = createFrameFromIR(ir)
    // Skip absolute placement when the parent positions us via Auto Layout.
    if (!parentHasAutoLayout) {
      frame.x = ir.layout.x - parentX
      frame.y = ir.layout.y - parentY
    }
    nodesCreated++
    tickProgress()

    const ownHasAutoLayout = ir.autoLayout !== null
    // CSS z-index: sort children ascending so higher z-index lands later
    // in the child list (= on top in Figma). Stable sort preserves source
    // order for ties, matching CSS painting semantics for siblings with
    // the same z-index.
    const orderedChildren =
      ownHasAutoLayout
        ? ir.children
        : [...ir.children].sort((a, b) => a.zIndex - b.zIndex)
    for (const child of orderedChildren) {
      const node = buildNode(
        child,
        ir.layout.x,
        ir.layout.y,
        ownHasAutoLayout
      )
      if (node !== null) frame.appendChild(node)
    }

    // Apply Auto Layout AFTER all children are attached so Figma can
    // reflow with the full child list in one pass.
    if (ir.autoLayout !== null) {
      applyAutoLayout(frame, ir.autoLayout)
    }

    return frame
  }

  function buildText(
    ir: IRText,
    parentX: number,
    parentY: number,
    parentHasAutoLayout: boolean
  ): TextNode {
    const fontName = resolveFont(fontMap, {
      family: ir.fontFamily,
      weight: ir.fontWeight,
      style: ir.fontStyle
    })
    const node = createTextFromIR(ir, fontName)
    if (!parentHasAutoLayout) {
      node.x = ir.layout.x - parentX
      node.y = ir.layout.y - parentY
    }
    nodesCreated++
    return node
  }

  const root = buildFrame(doc.root, 0, 0, false)
  onProgress?.('done', totalNodes, totalNodes)
  return { root, nodesCreated }
}
