import type { IRFrame } from '../types/ir'

// Builds a FrameNode from an IRFrame. x/y placement is deferred to the
// orchestrator because frames are positioned relative to their parent
// in Figma; the IR carries container-absolute coordinates.
export function createFrameFromIR(ir: IRFrame): FrameNode {
  const frame = figma.createFrame()
  frame.name = ir.sourceTag
  frame.resize(
    Math.max(ir.layout.width, 0.01),
    Math.max(ir.layout.height, 0.01)
  )
  frame.opacity = ir.opacity

  if (ir.fills.length > 0) {
    frame.fills = ir.fills.map((f) => ({
      type: 'SOLID' as const,
      color: { r: f.color.r, g: f.color.g, b: f.color.b },
      opacity: f.color.a
    }))
  } else {
    frame.fills = []
  }

  const [tl, tr, br, bl] = ir.cornerRadius
  if (tl === tr && tr === br && br === bl) {
    frame.cornerRadius = tl
  } else {
    frame.topLeftRadius = tl
    frame.topRightRadius = tr
    frame.bottomRightRadius = br
    frame.bottomLeftRadius = bl
  }

  // Phase 1 has no Auto Layout (D1 / Phase 2). Children are absolutely
  // positioned within the parent frame.
  frame.clipsContent = false

  return frame
}
