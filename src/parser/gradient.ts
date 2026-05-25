import type { IRGradient, IRGradientStop } from '../types/ir'

import { parseColor } from './color'

// Parses a CSS background-image value into an IRGradient when it is a
// linear- or radial-gradient. Returns null for other values (url(),
// none, conic-gradient, image-set, ...).
//
// Phase 3.2 subset:
//   linear-gradient([<angle> | to <direction>,] <stop>, <stop>, ...)
//   radial-gradient([<shape/size/position>,] <stop>, <stop>, ...)
// Radial shape/size/position is currently dropped — gradient stays
// centered with a farthest-corner extent approximation.
export function parseGradient(value: string): IRGradient | null {
  if (!value || value === 'none') return null

  const trimmed = value.trim()

  // No /s flag — CSS computed values are single-line, and /s requires
  // ES2018 in the typechecker.
  const linear = trimmed.match(/^linear-gradient\((.+)\)$/)
  if (linear !== null) return parseLinear(linear[1])

  const radial = trimmed.match(/^radial-gradient\((.+)\)$/)
  if (radial !== null) return parseRadial(radial[1])

  return null
}

function parseLinear(args: string): IRGradient | null {
  const parts = splitTopLevelCommas(args).map((p) => p.trim())
  if (parts.length < 2) return null

  let angle = 180
  let stopStart = 0

  const first = parts[0]
  if (looksLikeAngle(first)) {
    angle = parseAngleToDegrees(first)
    stopStart = 1
  } else if (first.startsWith('to ')) {
    angle = directionToDegrees(first.slice(3).trim())
    stopStart = 1
  }

  const stops = parseStops(parts.slice(stopStart))
  if (stops.length < 2) return null

  return { kind: 'linear', angle, stops }
}

function parseRadial(args: string): IRGradient | null {
  const parts = splitTopLevelCommas(args).map((p) => p.trim())
  if (parts.length < 2) return null

  // First arg is either a stop or a shape/size/position descriptor.
  let stopStart = 0
  if (isRadialDescriptor(parts[0])) stopStart = 1

  const stops = parseStops(parts.slice(stopStart))
  if (stops.length < 2) return null

  return { kind: 'radial', angle: 0, stops }
}

const RADIAL_SHAPE_OR_SIZE = new Set([
  'circle',
  'ellipse',
  'closest-side',
  'closest-corner',
  'farthest-side',
  'farthest-corner'
])

function isRadialDescriptor(arg: string): boolean {
  if (arg.startsWith('at ')) return true
  const firstWord = arg.split(/\s+/)[0]
  return RADIAL_SHAPE_OR_SIZE.has(firstWord)
}

function looksLikeAngle(s: string): boolean {
  return /^-?\d+(\.\d+)?(deg|rad|grad|turn)$/.test(s)
}

function parseAngleToDegrees(s: string): number {
  const num = parseFloat(s)
  if (s.endsWith('turn')) return num * 360
  // 'grad' must come before 'rad' — both endsWith('rad') matches.
  if (s.endsWith('grad')) return num * 0.9
  if (s.endsWith('rad')) return (num * 180) / Math.PI
  return num
}

function directionToDegrees(dir: string): number {
  const d = dir.replace(/\s+/g, ' ').trim()
  switch (d) {
    case 'top':
      return 0
    case 'right':
      return 90
    case 'bottom':
      return 180
    case 'left':
      return 270
    case 'top right':
    case 'right top':
      return 45
    case 'bottom right':
    case 'right bottom':
      return 135
    case 'bottom left':
    case 'left bottom':
      return 225
    case 'top left':
    case 'left top':
      return 315
    default:
      return 180
  }
}

function parseStops(parts: string[]): IRGradientStop[] {
  const raw: Array<{ position: number | null; color: ReturnType<typeof parseColor> }> = []

  for (const part of parts) {
    const tokens = tokenize(part)
    if (tokens.length === 0) continue

    let position: number | null = null
    let colorTokens = tokens
    const last = tokens[tokens.length - 1]
    if (last.endsWith('%')) {
      position = parseFloat(last) / 100
      colorTokens = tokens.slice(0, -1)
    }

    const colorStr = colorTokens.join(' ')
    const color = parseColor(colorStr)
    raw.push({ position, color })
  }

  if (raw.length === 0) return []

  // First and last default to 0 and 1; intermediate unspecified
  // positions are linearly interpolated between adjacent known stops.
  if (raw[0].position === null) raw[0].position = 0
  if (raw[raw.length - 1].position === null) raw[raw.length - 1].position = 1

  let lastKnown = 0
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].position === null) continue
    const startPos = raw[lastKnown].position as number
    const endPos = raw[i].position as number
    const span = i - lastKnown
    for (let j = 1; j < span; j++) {
      raw[lastKnown + j].position = startPos + ((endPos - startPos) * j) / span
    }
    lastKnown = i
  }
  // Trailing unknowns (no later known anchor) clamp to last known value.
  let lastFilled = (raw[lastKnown].position as number) ?? 1
  for (let i = lastKnown + 1; i < raw.length; i++) {
    if (raw[i].position === null) raw[i].position = lastFilled
    else lastFilled = raw[i].position as number
  }

  return raw.map((r) => ({ position: r.position as number, color: r.color }))
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
  const trimmed = s.trim()
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ' ' && depth === 0) {
      if (i > start) out.push(trimmed.slice(start, i))
      start = i + 1
    }
  }
  if (start < trimmed.length) out.push(trimmed.slice(start))
  return out
}
