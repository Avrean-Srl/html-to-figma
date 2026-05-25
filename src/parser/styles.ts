import type {
  CornerRadius,
  IRColor,
  IRFill,
  IRFontRef
} from '../types/ir'
import { parseColor } from './color'

export function extractFills(cs: CSSStyleDeclaration): IRFill[] {
  const color = parseColor(cs.backgroundColor)
  if (color.a === 0) return []
  return [{ type: 'solid', color }]
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
