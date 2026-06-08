import type {
  CornerRadius,
  IRBlendMode,
  IRColor,
  IRFill,
  IRFontRef,
  IRShadow,
  IRStroke
} from '../types/ir'

import { parseColor } from './color'
import { parseGradients } from './gradient'
import { parseBoxShadow } from './shadow'

export function extractFills(cs: CSSStyleDeclaration): IRFill[] {
  const fills: IRFill[] = []

  const color = parseColor(cs.backgroundColor)
  if (color.a > 0) {
    fills.push({ type: 'solid', color })
  }

  // Gradients live on top of background-color (CSS painting order).
  // Figma fills are bottom-to-top in array order, so the LAST element
  // in fills is the topmost layer. CSS multi-background is the inverse:
  // the FIRST listed gradient sits on top. So we iterate CSS gradients
  // in reverse so the top CSS layer ends up last in the Figma fills.
  const bgImage = cs.backgroundImage
  if (bgImage && bgImage !== 'none') {
    const gradients = parseGradients(bgImage)
    for (let i = gradients.length - 1; i >= 0; i--) {
      fills.push({ type: 'gradient', gradient: gradients[i] })
    }
  }

  return fills
}

export function extractCornerRadius(cs: CSSStyleDeclaration): CornerRadius {
  const tl = parseFloat(cs.borderTopLeftRadius) || 0
  const tr = parseFloat(cs.borderTopRightRadius) || 0
  const br = parseFloat(cs.borderBottomRightRadius) || 0
  const bl = parseFloat(cs.borderBottomLeftRadius) || 0
  return [tl, tr, br, bl]
}

export function extractFontFamily(cs: CSSStyleDeclaration): string {
  const first = cs.fontFamily.split(',')[0].trim()
  return first.replace(/^["']|["']$/g, '')
}

export function extractFontStyle(
  cs: CSSStyleDeclaration
): 'normal' | 'italic' | 'oblique' {
  const fs = cs.fontStyle.toLowerCase()
  if (fs === 'italic') return 'italic'
  if (fs.startsWith('oblique')) return 'oblique'
  return 'normal'
}

export function extractFontRef(cs: CSSStyleDeclaration): IRFontRef {
  return {
    family: extractFontFamily(cs),
    weight: parseInt(cs.fontWeight, 10) || 400,
    style: extractFontStyle(cs)
  }
}

export function extractTextAlign(
  cs: CSSStyleDeclaration
): 'left' | 'right' | 'center' | 'justify' {
  const ta = cs.textAlign.toLowerCase()
  if (ta === 'right' || ta === 'center' || ta === 'justify') return ta
  return 'left'
}

export function extractTextDecoration(
  cs: CSSStyleDeclaration
): 'none' | 'underline' | 'line-through' {
  const line = (cs.textDecorationLine || cs.textDecoration).toLowerCase()
  if (line.includes('underline')) return 'underline'
  if (line.includes('line-through')) return 'line-through'
  return 'none'
}

export function extractLineHeight(
  cs: CSSStyleDeclaration,
  fontSize: number
): number {
  const lh = cs.lineHeight
  if (lh === 'normal') return fontSize * 1.2
  return parseFloat(lh) || fontSize * 1.2
}

export function extractLetterSpacing(cs: CSSStyleDeclaration): number {
  if (cs.letterSpacing === 'normal') return 0
  return parseFloat(cs.letterSpacing) || 0
}

export function extractTextColor(cs: CSSStyleDeclaration): IRColor {
  return parseColor(cs.color)
}

export function extractOpacity(cs: CSSStyleDeclaration): number {
  const o = parseFloat(cs.opacity)
  if (Number.isNaN(o)) return 1
  return o
}

export function isHidden(cs: CSSStyleDeclaration): boolean {
  return cs.display === 'none' || cs.visibility === 'hidden'
}

export function extractZIndex(cs: CSSStyleDeclaration): number {
  if (cs.zIndex === 'auto' || cs.zIndex === '') return 0
  const n = parseInt(cs.zIndex, 10)
  return Number.isNaN(n) ? 0 : n
}

// Any non-visible overflow on either axis means the box clips its
// content. `auto` and `scroll` clip too (a browser shows a scrollbar;
// Figma has none, so the off-box content is hidden) - e.g. a code box
// with `overflow-x: auto` holding an unbreakable hash string would
// otherwise spill past the frame. The CSS rule that a single non-visible
// axis forces the other to clip as well means checking each axis for
// any of hidden/clip/auto/scroll is sufficient.
const CLIPPING_OVERFLOW = new Set(['hidden', 'clip', 'auto', 'scroll'])

export function extractClipsContent(cs: CSSStyleDeclaration): boolean {
  return (
    CLIPPING_OVERFLOW.has(cs.overflow) ||
    CLIPPING_OVERFLOW.has(cs.overflowX) ||
    CLIPPING_OVERFLOW.has(cs.overflowY)
  )
}

export function extractShadows(cs: CSSStyleDeclaration): IRShadow[] {
  return parseBoxShadow(cs.boxShadow)
}

// Extracts a frame border. Uniform borders (all four sides equal) map
// to Figma's single strokeWeight; asymmetric borders (border-top only,
// a border-bottom divider, etc.) map to Figma's per-side stroke weights
// (strokeTopWeight / ...). Figma allows only ONE stroke paint per node,
// so when sides differ in color/style we pick the dominant non-zero
// side for color and style and keep the per-side widths.
export function extractStroke(cs: CSSStyleDeclaration): IRStroke | null {
  // A side only paints when its style is neither 'none' nor 'hidden';
  // zero out the width of any non-painting side so border-top-only
  // (where right/bottom/left default to style:none) keeps just the top.
  const sideStyle = [
    cs.borderTopStyle,
    cs.borderRightStyle,
    cs.borderBottomStyle,
    cs.borderLeftStyle
  ]
  const widths = [
    parseFloat(cs.borderTopWidth) || 0,
    parseFloat(cs.borderRightWidth) || 0,
    parseFloat(cs.borderBottomWidth) || 0,
    parseFloat(cs.borderLeftWidth) || 0
  ].map((w, i) =>
    sideStyle[i] === 'none' || sideStyle[i] === 'hidden' ? 0 : w
  )
  if (widths.every((w) => w === 0)) return null

  const colors = [
    cs.borderTopColor,
    cs.borderRightColor,
    cs.borderBottomColor,
    cs.borderLeftColor
  ]

  // Color + style come from the painting sides only. Empty (zero-width)
  // sides report the CSS-default border color (the element's text color)
  // which would skew the choice, so we ignore them.
  const paintingIdx = widths
    .map((w, i) => (w > 0 ? i : -1))
    .filter((i) => i >= 0)
  // Dominant side = thickest painting side (ties resolve to the first,
  // i.e. top > right > bottom > left), used to pick the shared paint.
  const dominant = paintingIdx.reduce((best, i) =>
    widths[i] > widths[best] ? i : best
  )
  const color = parseColor(colors[dominant])

  // Border-style maps to a single dashPattern in Figma. When painting
  // sides disagree on style, fall back to the dominant side's style.
  const style = mapBorderStyle(sideStyle[dominant])

  const uniform = paintingIdx.length === 4 && widths.every((w) => w === widths[0])
  if (uniform) {
    return { width: widths[0], color, style }
  }

  return {
    width: widths[dominant],
    sides: {
      top: widths[0],
      right: widths[1],
      bottom: widths[2],
      left: widths[3]
    },
    color,
    style
  }
}

function mapBorderStyle(s: string): 'solid' | 'dashed' | 'dotted' {
  if (s === 'dashed') return 'dashed'
  if (s === 'dotted') return 'dotted'
  // double / groove / ridge / inset / outset all approximate as solid
  // in Figma - we lose the visual fidelity, but the layout stays right.
  return 'solid'
}

export function extractBlendMode(cs: CSSStyleDeclaration): IRBlendMode {
  const m = cs.mixBlendMode
  switch (m) {
    case 'multiply':
    case 'screen':
    case 'overlay':
    case 'darken':
    case 'lighten':
    case 'color-dodge':
    case 'color-burn':
    case 'hard-light':
    case 'soft-light':
    case 'difference':
    case 'exclusion':
    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity':
      return m
    default:
      return 'normal'
  }
}

// True when an element carries visual styling that would be lost if we
// flattened it into a plain IRText. Background (color or gradient),
// corner radius, padding, border, and box-shadow all change the
// rendered box - they must survive as a frame wrapping the text.
export function hasFrameWorthyStyling(cs: CSSStyleDeclaration): boolean {
  const bg = parseColor(cs.backgroundColor)
  if (bg.a > 0) return true

  if (cs.backgroundImage && cs.backgroundImage !== 'none') return true

  const tl = parseFloat(cs.borderTopLeftRadius) || 0
  const tr = parseFloat(cs.borderTopRightRadius) || 0
  const br = parseFloat(cs.borderBottomRightRadius) || 0
  const bl = parseFloat(cs.borderBottomLeftRadius) || 0
  if (tl > 0 || tr > 0 || br > 0 || bl > 0) return true

  const pt = parseFloat(cs.paddingTop) || 0
  const pr = parseFloat(cs.paddingRight) || 0
  const pb = parseFloat(cs.paddingBottom) || 0
  const pl = parseFloat(cs.paddingLeft) || 0
  if (pt > 0 || pr > 0 || pb > 0 || pl > 0) return true

  // Any painting border side (top / right / bottom / left). A lone
  // border-bottom divider or border-top separator must survive as a
  // frame so its stroke is not flattened away.
  const borderSides: Array<[string, string]> = [
    [cs.borderTopWidth, cs.borderTopStyle],
    [cs.borderRightWidth, cs.borderRightStyle],
    [cs.borderBottomWidth, cs.borderBottomStyle],
    [cs.borderLeftWidth, cs.borderLeftStyle]
  ]
  if (
    borderSides.some(
      ([w, s]) => (parseFloat(w) || 0) > 0 && s !== 'none' && s !== 'hidden'
    )
  ) {
    return true
  }

  if (cs.boxShadow && cs.boxShadow !== 'none') return true

  return false
}
