import type { IRFrame } from '../types/ir'

import { buildShadowEffects, mapBlendMode } from './effects'
import { fillToPaint } from './paint'

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
    frame.fills = ir.fills.map(fillToPaint)
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

  if (ir.shadows.length > 0) {
    frame.effects = buildShadowEffects(ir.shadows)
  }

  if (ir.stroke !== null) {
    frame.strokes = [
      {
        type: 'SOLID',
        color: {
          r: ir.stroke.color.r,
          g: ir.stroke.color.g,
          b: ir.stroke.color.b
        },
        opacity: ir.stroke.color.a
      }
    ]
    // INSIDE matches box-sizing: border-box visually - the border lives
    // within the frame box rather than extending it. Set this BEFORE the
    // per-side weights: Figma resolves individual stroke weights against
    // the current strokeAlign.
    frame.strokeAlign = 'INSIDE'
    if (ir.stroke.sides) {
      // Asymmetric border (e.g. border-top only, a border-bottom
      // divider). Figma frames carry one stroke paint but per-side
      // weights, so the color/style above are shared and each edge gets
      // its own thickness. A 0-weight side simply draws nothing.
      frame.strokeTopWeight = ir.stroke.sides.top
      frame.strokeRightWeight = ir.stroke.sides.right
      frame.strokeBottomWeight = ir.stroke.sides.bottom
      frame.strokeLeftWeight = ir.stroke.sides.left
    } else {
      frame.strokeWeight = ir.stroke.width
    }
    // Map CSS border-style to Figma's dashPattern. The numbers below
    // are the same defaults the Figma UI ships in its stroke style
    // picker - dashed ≈ "8px on, 4px off", dotted ≈ square dots whose
    // size scales with stroke weight so 1px borders stay legible.
    if (ir.stroke.style === 'dashed') {
      frame.dashPattern = [8, 4]
    } else if (ir.stroke.style === 'dotted') {
      const dot = Math.max(ir.stroke.width, 1)
      frame.dashPattern = [dot, dot * 2]
      // Round dash ends so dots look like dots, not tiny rectangles.
      frame.strokeCap = 'ROUND'
    } else {
      frame.dashPattern = []
    }
  }

  // Only override the default frame blendMode ('PASS_THROUGH') when the
  // CSS author asked for something specific. Leaving 'normal' alone
  // keeps Figma's natural group-blending semantics.
  if (ir.blendMode !== 'normal') {
    frame.blendMode = mapBlendMode(ir.blendMode)
  }

  // Phase 1 has no Auto Layout (D1 / Phase 2). Children are absolutely
  // positioned within the parent frame. clipsContent toggled in Phase 5
  // from CSS overflow: hidden | clip.
  frame.clipsContent = ir.clipsContent

  return frame
}
