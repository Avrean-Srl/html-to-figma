import type { IRAutoLayout } from '../types/ir'

// Applies an IR Auto Layout spec to a freshly-created Figma FrameNode.
// Call this AFTER children are appended so Figma reflows with all
// items present. Sizing modes are FIXED so the frame keeps the
// dimensions we measured in the iframe - content overflows visibly
// rather than auto-shrinking, which preserves the user's expectation
// of "what they pasted is what they get on the canvas".
//
// Ordering matters: when layoutMode flips from NONE to HORIZONTAL/VERTICAL
// on a frame whose sizing modes are still 'AUTO' (the default for a fresh
// frame), Figma instantly hug-snaps the frame to its children's content
// extent. Setting primaryAxisSizingMode = 'FIXED' afterwards just freezes
// the already-shrunk size, it does not restore. Real-world symptom: a
// horizontal nav with `justify-content: space-between` was rendering at
// `logo_w + links_w` instead of the parent's content width. So:
//  1. Capture the resized width/height first.
//  2. Set layoutMode.
//  3. Immediately pin sizing modes to FIXED so subsequent writes don't
//     re-trigger any hug behavior.
//  4. Set the rest of the AL properties.
//  5. Defensively resize back to the captured dimensions if the frame
//     drifted (it should not, but cheap insurance).
export function applyAutoLayout(
  frame: FrameNode,
  ir: IRAutoLayout
): void {
  const targetWidth = frame.width
  const targetHeight = frame.height

  frame.layoutMode = ir.direction === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL'

  frame.primaryAxisSizingMode = 'FIXED'
  frame.counterAxisSizingMode = 'FIXED'

  frame.itemSpacing = ir.gap

  frame.paddingTop = ir.padding.top
  frame.paddingRight = ir.padding.right
  frame.paddingBottom = ir.padding.bottom
  frame.paddingLeft = ir.padding.left

  frame.primaryAxisAlignItems = mapPrimaryAlign(ir.primaryAxisAlign)
  frame.counterAxisAlignItems = mapCounterAlign(ir.counterAxisAlign)

  frame.layoutWrap = ir.wrap ? 'WRAP' : 'NO_WRAP'

  if (frame.width !== targetWidth || frame.height !== targetHeight) {
    frame.resize(Math.max(targetWidth, 0.01), Math.max(targetHeight, 0.01))
  }
}

function mapPrimaryAlign(
  v: IRAutoLayout['primaryAxisAlign']
): 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' {
  switch (v) {
    case 'min':
      return 'MIN'
    case 'center':
      return 'CENTER'
    case 'max':
      return 'MAX'
    case 'space-between':
      return 'SPACE_BETWEEN'
  }
}

function mapCounterAlign(
  v: IRAutoLayout['counterAxisAlign']
): 'MIN' | 'CENTER' | 'MAX' {
  switch (v) {
    case 'min':
      return 'MIN'
    case 'center':
      return 'CENTER'
    case 'max':
      return 'MAX'
  }
}
