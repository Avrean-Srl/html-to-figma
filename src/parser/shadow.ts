import type { IRShadow } from '../types/ir'

import { parseColor } from './color'

// Parses CSS box-shadow into zero or more IRShadow.
// getComputedStyle returns the resolved form which is comma-separated
// shadows, each shadow token-separated. Browsers normalize color to
// the front of each shadow segment, e.g.
//   rgba(0, 0, 0, 0.1) 0px 4px 6px 0px
//   inset rgba(0, 0, 0, 0.5) 0px 1px 2px
// We tokenize carefully because the color may itself contain commas
// (rgba) and parens.
export function parseBoxShadow(value: string): IRShadow[] {
  if (!value || value === 'none') return []

  const segments = splitTopLevelCommas(value)
  const out: IRShadow[] = []
  for (const seg of segments) {
    const shadow = parseSegment(seg.trim())
    if (shadow !== null) out.push(shadow)
  }
  return out
}

function parseSegment(seg: string): IRShadow | null {
  const tokens = tokenize(seg)

  let inset = false
  let colorToken: string | null = null
  const numbers: number[] = []

  for (const tok of tokens) {
    if (tok === 'inset') {
      inset = true
      continue
    }
    if (isColorToken(tok)) {
      colorToken = tok
      continue
    }
    const n = parseFloat(tok)
    if (!Number.isNaN(n)) numbers.push(n)
  }

  // box-shadow needs at least offset-x and offset-y.
  if (numbers.length < 2) return null

  return {
    type: inset ? 'inner' : 'drop',
    offsetX: numbers[0],
    offsetY: numbers[1],
    blur: numbers[2] ?? 0,
    spread: numbers[3] ?? 0,
    color: parseColor(colorToken ?? 'rgba(0, 0, 0, 1)')
  }
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      out.push(s.slice(start, i))
      start = i + 1
    }
  }
  out.push(s.slice(start))
  return out
}

function tokenize(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ' ' && depth === 0) {
      if (i > start) out.push(s.slice(start, i))
      start = i + 1
    }
  }
  if (start < s.length) out.push(s.slice(start))
  return out
}

function isColorToken(tok: string): boolean {
  if (tok.startsWith('#')) return true
  if (/^(rgb|rgba|hsl|hsla)\(/i.test(tok)) return true
  // Bare identifiers other than 'inset' are treated as named colors.
  if (/^[a-z][a-z-]*$/i.test(tok) && tok !== 'inset') return true
  return false
}
