import type { IRAutoLayout } from '../types/ir'

// Detects CSS flexbox on an element and produces the IR contract that
// the mapper turns into Figma Auto Layout. Everything else (grid,
// block, inline, table, ...) returns null and falls back to absolute
// positioning - browsers already measure those layouts correctly via
// getBoundingClientRect, so reproducing them in Figma is a matter of
// dropping each child at its measured x/y. Trying to reflow grid /
// block layouts via Figma Auto Layout reliably introduces drift, so
// we just don't.
//
// Mapped subset:
//   display: flex | inline-flex     -> auto layout enabled (FIXED)
//   flex-direction: row | column    -> horizontal | vertical
//                  (reverse keywords collapse to forward; reordering
//                   children would require a deeper walker change.)
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

  const direction: 'horizontal' | 'vertical' =
    cs.flexDirection === 'column' || cs.flexDirection === 'column-reverse'
      ? 'vertical'
      : 'horizontal'
  const isVertical = direction === 'vertical'
  const primaryGap = isVertical
    ? parseFloat(cs.rowGap) || 0
    : parseFloat(cs.columnGap) || 0

  return {
    direction,
    gap: primaryGap,
    padding: {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0
    },
    primaryAxisAlign: mapJustifyContent(cs.justifyContent),
    counterAxisAlign: mapAlignItems(cs.alignItems),
    wrap: cs.flexWrap === 'wrap' || cs.flexWrap === 'wrap-reverse',
    // FIXED on both axes by default. We deliberately do NOT auto-HUG
    // inline-flex chips here, because it caused content drift when
    // Figma's text metrics differ from the browser's. If you import a
    // chip and want it to hug, change it in Figma - the layout will be
    // correct first.
    primaryAxisSizing: 'fixed',
    counterAxisSizing: 'fixed'
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
