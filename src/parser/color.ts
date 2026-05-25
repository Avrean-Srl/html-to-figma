import type { IRColor } from '../types/ir'

const BLACK: IRColor = { r: 0, g: 0, b: 0, a: 1 }
const TRANSPARENT: IRColor = { r: 0, g: 0, b: 0, a: 0 }

// Parses any CSS color string by letting the browser normalize via a 2d
// canvas context. ctx.fillStyle = '<anything>' yields either '#rrggbb'
// (alpha = 1) or 'rgba(r, g, b, a)' (alpha < 1), no edge cases for us
// to handle. Returns black for unrecognized inputs and a fully
// transparent color for 'transparent' and empty strings.
export function parseColor(input: string): IRColor {
  if (!input) return TRANSPARENT
  const trimmed = input.trim().toLowerCase()
  if (trimmed === 'transparent' || trimmed === 'none') return TRANSPARENT

  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return BLACK

  ctx.fillStyle = '#000000'
  ctx.fillStyle = input
  const normalized = ctx.fillStyle

  if (typeof normalized !== 'string') return BLACK

  if (normalized.startsWith('#')) {
    return {
      r: parseInt(normalized.slice(1, 3), 16) / 255,
      g: parseInt(normalized.slice(3, 5), 16) / 255,
      b: parseInt(normalized.slice(5, 7), 16) / 255,
      a: 1
    }
  }

  const match = normalized.match(/rgba?\(([^)]+)\)/)
  if (!match) return BLACK

  const parts = match[1].split(',').map((s) => s.trim())
  if (parts.length < 3) return BLACK

  return {
    r: parseInt(parts[0], 10) / 255,
    g: parseInt(parts[1], 10) / 255,
    b: parseInt(parts[2], 10) / 255,
    a: parts.length >= 4 ? parseFloat(parts[3]) : 1
  }
}
