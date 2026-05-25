import type { IRAutoLayout } from '../types/ir'

// Detects CSS flexbox on an element and produces the IR contract that
// the mapper turns into Figma Auto Layout. Non-flex elements return
// null and stay absolutely positioned.
//
// Mapped subset (Phase 2):
//   display: flex | inline-flex     -> auto layout enabled
//   flex-direction: row | column    -> horizontal | vertical
//                  (row-reverse and column-reverse collapse to forward
//                   for now; CSS reverse + Figma needs explicit child
//                   reorder, deferred)
//   justify-content                 -> primary-axis align
//   align-items                     -> counter-axis align
//   gap / row-gap / column-gap      -> primary-axis spacing
//   padding-{top,right,bottom,left} -> per-side padding
//   flex-wrap: wrap | wrap-reverse  -> wrap = true
export function extractAutoLayout(
  cs: CSSStyleDeclaration
): IRAutoLayout | null {
  const display = cs.display
  if (display !== 'flex' && display !== 'inline-flex') return null

  const direction = cs.flexDirection
  const isVertical = direction === 'column' || direction === 'column-reverse'

  const primaryGap = isVertical
    ? parseFloat(cs.rowGap) || 0
    : parseFloat(cs.columnGap) || 0

  return {
    direction: isVertical ? 'vertical' : 'horizontal',
    gap: primaryGap,
    padding: {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0
    },
    primaryAxisAlign: mapJustifyContent(cs.justifyContent),
    counterAxisAlign: mapAlignItems(cs.alignItems),
    wrap: cs.flexWrap === 'wrap' || cs.flexWrap === 'wrap-reverse'
  }
}

function mapJustifyContent(
  jc: string
): 'min' | 'center' | 'max' | 'space-between' {
  switch (jc) {
    case 'center':
      return 'center'
    case 'flex-end':
    case 'end':
    case 'right':
      return 'max'
    case 'space-between':
    case 'space-around':
    case 'space-evenly':
      // Figma only models SPACE_BETWEEN. space-around/-evenly are
      // approximated to it - closest available behavior.
      return 'space-between'
    default:
      return 'min'
  }
}

function mapAlignItems(ai: string): 'min' | 'center' | 'max' {
  switch (ai) {
    case 'center':
      return 'center'
    case 'flex-end':
    case 'end':
    case 'last baseline':
      return 'max'
    // 'stretch' (the CSS default) collapses to MIN here. Figma stretches
    // along the counter axis only when sizingMode is set explicitly,
    // which we keep FIXED in Phase 2.
    default:
      return 'min'
  }
}
