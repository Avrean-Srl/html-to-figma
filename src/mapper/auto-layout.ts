import type { IRAutoLayout } from '../types/ir'

// Applies an IR Auto Layout spec to a freshly-created Figma FrameNode.
// Call this AFTER children are appended so Figma reflows with all
// items present. Sizing modes are FIXED so the frame keeps the
// dimensions we measured in the iframe — content overflows visibly
// rather than auto-shrinking, which preserves the user's expectation
// of "what they pasted is what they get on the canvas".
export function applyAutoLayout(
  frame: FrameNode,
  ir: IRAutoLayout
): void {
  frame.layoutMode = ir.direction === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL'

  frame.itemSpacing = ir.gap

  frame.paddingTop = ir.padding.top
  frame.paddingRight = ir.padding.right
  frame.paddingBottom = ir.padding.bottom
  frame.paddingLeft = ir.padding.left

  frame.primaryAxisAlignItems = mapPrimaryAlign(ir.primaryAxisAlign)
  frame.counterAxisAlignItems = mapCounterAlign(ir.counterAxisAlign)

  frame.primaryAxisSizingMode = 'FIXED'
  frame.counterAxisSizingMode = 'FIXED'

  frame.layoutWrap = ir.wrap ? 'WRAP' : 'NO_WRAP'
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
