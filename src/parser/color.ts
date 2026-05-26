import type { IRColor } from '../types/ir'

const TRANSPARENT: IRColor = { r: 0, g: 0, b: 0, a: 0 }
// Sentinel used to detect "canvas refused to parse this color". A real
// CSS color would resolve to a unique #rrggbb value; we keep this here
// instead of inline so accidental hits on the literal `#aabbcd` are
// easier to grep for.
const SENTINEL_RGB = '#abcdef'

// Parses any CSS color string by letting the browser normalize via a 2d
// canvas context. ctx.fillStyle = '<anything>' yields either '#rrggbb'
// (alpha = 1) or 'rgba(r, g, b, a)' (alpha < 1) for valid inputs. For
// inputs the canvas implementation does not recognize (e.g. oklch() on
// older CEF, lch(), color-mix(), or any future CSS Color Level 4
// function not yet shipped), `fillStyle` keeps its previous value
// silently - the historical bug was reading that stale value as the
// "answer", which turned every unparseable background into opaque
// black. We now detect that case with a sentinel and return
// TRANSPARENT so the failure is visible-by-omission rather than
// aggressively dark.
export function parseColor(input: string): IRColor {
  if (!input) return TRANSPARENT
  const trimmed = input.trim().toLowerCase()
  if (trimmed === 'transparent' || trimmed === 'none') return TRANSPARENT

  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (ctx === null) return TRANSPARENT

  ctx.fillStyle = SENTINEL_RGB
  ctx.fillStyle = input
  const normalized = ctx.fillStyle

  if (typeof normalized !== 'string') return TRANSPARENT
  // Canvas silently rejected `input`; bail before reading the sentinel
  // as if it were a real result.
  if (normalized.toLowerCase() === SENTINEL_RGB) return TRANSPARENT

  if (normalized.startsWith('#')) {
    return {
      r: parseInt(normalized.slice(1, 3), 16) / 255,
      g: parseInt(normalized.slice(3, 5), 16) / 255,
      b: parseInt(normalized.slice(5, 7), 16) / 255,
      a: 1
    }
  }

  const match = normalized.match(/rgba?\(([^)]+)\)/)
  if (match === null) return TRANSPARENT

  const parts = match[1].split(',').map((s) => s.trim())
  if (parts.length < 3) return TRANSPARENT

  return {
    r: parseInt(parts[0], 10) / 255,
    g: parseInt(parts[1], 10) / 255,
    b: parseInt(parts[2], 10) / 255,
    a: parts.length >= 4 ? parseFloat(parts[3]) : 1
  }
}
