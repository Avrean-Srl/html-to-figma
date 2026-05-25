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
import { parseGradient } from './gradient'
import { parseBoxShadow } from './shadow'

export function extractFills(cs: CSSStyleDeclaration): IRFill[] {
  const fills: IRFill[] = []

  const color = parseColor(cs.backgroundColor)
  if (color.a > 0) {
    fills.push({ type: 'solid', color })
  }

  // Gradients live on top of background-color (CSS painting order).
  // Figma fills are bottom-to-top in array order, so we push gradient
  // after solid to layer correctly.
  const bgImage = cs.backgroundImage
  if (bgImage && bgImage !== 'none') {
    const gradient = parseGradient(bgImage)
    if (gradient !== null) {
      fills.push({ type: 'gradient', gradient })
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

export function extractClipsContent(cs: CSSStyleDeclaration): boolean {
  return (
    cs.overflow === 'hidden' ||
    cs.overflow === 'clip' ||
    cs.overflowX === 'hidden' ||
    cs.overflowX === 'clip' ||
    cs.overflowY === 'hidden' ||
    cs.overflowY === 'clip'
  )
}

export function extractShadows(cs: CSSStyleDeclaration): IRShadow[] {
  return parseBoxShadow(cs.boxShadow)
}

// Uniform border only in Phase 3.1. Per-side borders (e.g. border-bottom
// only) are CSS-common but Figma has no per-side stroke - that's a
// separate workaround pass (synthetic thin frames as borders) deferred.
// We detect uniform borders by requiring all four sides to match.
export function extractStroke(cs: CSSStyleDeclaration): IRStroke | null {
  const widths = [
    parseFloat(cs.borderTopWidth) || 0,
    parseFloat(cs.borderRightWidth) || 0,
    parseFloat(cs.borderBottomWidth) || 0,
    parseFloat(cs.borderLeftWidth) || 0
  ]
  if (widths.every((w) => w === 0)) return null

  const styles = [
    cs.borderTopStyle,
    cs.borderRightStyle,
    cs.borderBottomStyle,
    cs.borderLeftStyle
  ]
  if (styles.some((s) => s === 'none' || s === 'hidden')) return null

  // Reject per-side borders: all four widths and colors must match.
  if (!widths.every((w) => w === widths[0])) return null

  const colors = [
    cs.borderTopColor,
    cs.borderRightColor,
    cs.borderBottomColor,
    cs.borderLeftColor
  ]
  if (!colors.every((c) => c === colors[0])) return null

  return {
    width: widths[0],
    color: parseColor(colors[0])
  }
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

  // Uniform border with non-zero width
  const bw = parseFloat(cs.borderTopWidth) || 0
  if (bw > 0 && cs.borderTopStyle !== 'none') return true

  if (cs.boxShadow && cs.boxShadow !== 'none') return true

  return false
}
