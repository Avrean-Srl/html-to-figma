import type { IRSvg } from '../types/ir'

import { mapBlendMode } from './effects'

// figma.createNodeFromSvg parses raw SVG markup and returns a FrameNode
// containing vector children. It is synchronous. Text inside SVG becomes
// vector paths - a known limitation (documented for users) since Phase 1
// text mapping doesn't apply here.
//
// The WHOLE import is wrapped, not just the parse call. SVG markup Figma
// can't represent - the documented offender is a <pattern> fill referenced
// via `fill="url(#id)"` (e.g. a dotted-background overlay) - makes Figma
// throw a raw "object is not extensible" TypeError. That throw can surface
// either from createNodeFromSvg itself OR later, when we touch the returned
// node's frozen `fills` property. Either way an unguarded throw aborts the
// ENTIRE import, so on any failure we discard the half-built node (removing
// it from the scene so it doesn't litter the canvas) and fall back to an
// empty placeholder frame that preserves the layout box - same
// belt-and-suspenders philosophy as the image builder's bad-bytes path.
export function createSvgFromIR(ir: IRSvg): FrameNode {
  let imported: FrameNode | null = null
  try {
    imported = figma.createNodeFromSvg(ir.svg)
    imported.name = 'svg'
    // createNodeFromSvg sets a natural size from the SVG viewBox.
    // We override to the rendered HTML size to keep layout consistent.
    imported.resize(
      Math.max(ir.layout.width, 0.01),
      Math.max(ir.layout.height, 0.01)
    )
    imported.opacity = ir.opacity
    imported.fills = []
    if (ir.blendMode !== 'normal') {
      imported.blendMode = mapBlendMode(ir.blendMode)
    }
    return imported
  } catch {
    if (imported !== null) {
      // The node was created but is unusable; drop it so it doesn't float
      // as a stray empty frame at the canvas origin.
      try {
        imported.remove()
      } catch {
        // Best effort - if removal also fails, leave it rather than throw.
      }
    }
    return placeholderFrame(ir)
  }
}

function placeholderFrame(ir: IRSvg): FrameNode {
  const node = figma.createFrame()
  node.name = '[svg unsupported]'
  node.resize(
    Math.max(ir.layout.width, 0.01),
    Math.max(ir.layout.height, 0.01)
  )
  node.opacity = ir.opacity
  node.fills = []
  return node
}
