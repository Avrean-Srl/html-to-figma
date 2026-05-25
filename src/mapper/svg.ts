import type { IRSvg } from '../types/ir'

import { mapBlendMode } from './effects'

// figma.createNodeFromSvg parses raw SVG markup and returns a FrameNode
// containing vector children. It is synchronous. Text inside SVG becomes
// vector paths — a known limitation (documented for users) since Phase 1
// text mapping doesn't apply here.
export function createSvgFromIR(ir: IRSvg): FrameNode {
  const node = figma.createNodeFromSvg(ir.svg)
  node.name = 'svg'
  // createNodeFromSvg sets a natural size from the SVG viewBox.
  // We override to the rendered HTML size to keep layout consistent.
  node.resize(
    Math.max(ir.layout.width, 0.01),
    Math.max(ir.layout.height, 0.01)
  )
  node.opacity = ir.opacity
  node.fills = []
  if (ir.blendMode !== 'normal') {
    node.blendMode = mapBlendMode(ir.blendMode)
  }
  return node
}
