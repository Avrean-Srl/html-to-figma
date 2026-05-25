import type { IRDocument, IRFrame, IRNode, IRText } from '../types/ir'

import { createFrameFromIR } from './frame'
import { resolveAndLoadFonts, resolveFont } from './fonts'
import { createTextFromIR } from './text'

export interface MaterializeResult {
  root: FrameNode
  nodesCreated: number
}

export async function materializeIR(
  doc: IRDocument
): Promise<MaterializeResult> {
  const fontMap = await resolveAndLoadFonts(doc.fontsUsed)

  let nodesCreated = 0

  function buildNode(
    ir: IRNode,
    parentX: number,
    parentY: number
  ): SceneNode | null {
    if (ir.type === 'frame') return buildFrame(ir, parentX, parentY)
    if (ir.type === 'text') return buildText(ir, parentX, parentY)
    // image and svg: deferred to Phase 4
    return null
  }

  function buildFrame(
    ir: IRFrame,
    parentX: number,
    parentY: number
  ): FrameNode {
    const frame = createFrameFromIR(ir)
    frame.x = ir.layout.x - parentX
    frame.y = ir.layout.y - parentY
    nodesCreated++

    for (const child of ir.children) {
      const node = buildNode(child, ir.layout.x, ir.layout.y)
      if (node !== null) frame.appendChild(node)
    }

    return frame
  }

  function buildText(ir: IRText, parentX: number, parentY: number): TextNode {
    const fontName = resolveFont(fontMap, {
      family: ir.fontFamily,
      weight: ir.fontWeight,
      style: ir.fontStyle
    })
    const node = createTextFromIR(ir, fontName)
    node.x = ir.layout.x - parentX
    node.y = ir.layout.y - parentY
    nodesCreated++
    return node
  }

  const root = buildFrame(doc.root, 0, 0)
  return { root, nodesCreated }
}
