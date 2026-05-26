// Rewrites modern CSS color functions (oklch, oklab) that may not be
// supported by the embedded Chromium running the Figma plugin into
// rgba() equivalents that every Chromium has handled for years.
// Tailwind v4 generates oklch() by default and most modern design
// systems (e.g. shadcn presets, custom OKLCH token sets) follow suit,
// so a single unstyled boero-grade mockup is enough to expose the gap.
//
// We don't try to be a full Color Level 4 polyfill - rgb/hsl/named
// colors work natively in every target, gradients pass through
// untouched, and color-mix() is rare enough in production CSS to defer.
// Returned strings are best-effort RGBA approximations clamped to
// sRGB; out-of-gamut OKLCH values are clipped (Figma fills are sRGB
// anyway, so wider-gamut accuracy is not preserved downstream).

const OKLCH_RE = /oklch\(\s*([^)]+)\s*\)/gi
const OKLAB_RE = /oklab\(\s*([^)]+)\s*\)/gi

export function rewriteModernCssColors(input: string): string {
  let out = input.replace(OKLCH_RE, (_match, args: string) => {
    const rgba = oklchArgsToRgba(args)
    return rgba ?? _match
  })
  out = out.replace(OKLAB_RE, (_match, args: string) => {
    const rgba = oklabArgsToRgba(args)
    return rgba ?? _match
  })
  return out
}

// "L C H" or "L C H / A" - any of L/C/H/A may be % / number / 'none'.
function oklchArgsToRgba(args: string): string | null {
  const [colorPart, alphaPart] = splitOnSlash(args)
  const tokens = colorPart.trim().split(/\s+/)
  if (tokens.length < 3) return null
  const L = parseLightness(tokens[0])
  const C = parseNumber(tokens[1])
  const H = parseHue(tokens[2])
  if (L === null || C === null || H === null) return null
  const a = parseAlpha(alphaPart)
  const [r, g, b] = oklchToSrgb(L, C, H)
  return formatRgba(r, g, b, a)
}

function oklabArgsToRgba(args: string): string | null {
  const [colorPart, alphaPart] = splitOnSlash(args)
  const tokens = colorPart.trim().split(/\s+/)
  if (tokens.length < 3) return null
  const L = parseLightness(tokens[0])
  const A = parseSignedNumber(tokens[1])
  const B = parseSignedNumber(tokens[2])
  if (L === null || A === null || B === null) return null
  const a = parseAlpha(alphaPart)
  const [r, g, b] = oklabToSrgb(L, A, B)
  return formatRgba(r, g, b, a)
}

function splitOnSlash(args: string): [string, string | undefined] {
  const i = args.indexOf('/')
  if (i === -1) return [args, undefined]
  return [args.slice(0, i), args.slice(i + 1)]
}

function parseLightness(tok: string): number | null {
  if (tok === 'none') return 0
  if (tok.endsWith('%')) {
    const n = parseFloat(tok)
    return Number.isFinite(n) ? n / 100 : null
  }
  const n = parseFloat(tok)
  return Number.isFinite(n) ? n : null
}

function parseNumber(tok: string): number | null {
  if (tok === 'none') return 0
  // OKLCH chroma accepts % too (% of max ~0.4 in spec; treat 100% = 0.4).
  if (tok.endsWith('%')) {
    const n = parseFloat(tok)
    return Number.isFinite(n) ? (n / 100) * 0.4 : null
  }
  const n = parseFloat(tok)
  return Number.isFinite(n) ? n : null
}

function parseSignedNumber(tok: string): number | null {
  if (tok === 'none') return 0
  if (tok.endsWith('%')) {
    const n = parseFloat(tok)
    return Number.isFinite(n) ? (n / 100) * 0.4 : null
  }
  const n = parseFloat(tok)
  return Number.isFinite(n) ? n : null
}

function parseHue(tok: string): number | null {
  if (tok === 'none') return 0
  const lower = tok.toLowerCase()
  // Check 'grad' BEFORE 'rad' because 'grad' also ends with 'rad'.
  if (lower.endsWith('grad')) {
    const n = parseFloat(lower)
    return Number.isFinite(n) ? n * 0.9 : null
  }
  if (lower.endsWith('turn')) {
    const n = parseFloat(lower)
    return Number.isFinite(n) ? n * 360 : null
  }
  if (lower.endsWith('rad')) {
    const n = parseFloat(lower)
    return Number.isFinite(n) ? (n * 180) / Math.PI : null
  }
  // 'deg' or bare number = degrees.
  const n = parseFloat(lower)
  return Number.isFinite(n) ? n : null
}

function parseAlpha(tok: string | undefined): number {
  if (tok === undefined) return 1
  const trimmed = tok.trim()
  if (trimmed === 'none') return 0
  if (trimmed.endsWith('%')) {
    const n = parseFloat(trimmed)
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n / 100)) : 1
  }
  const n = parseFloat(trimmed)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1
}

// OKLCH -> OKLAB -> linear sRGB -> gamma-encoded sRGB. Matrices from
// the CSS Color Level 4 spec.
function oklchToSrgb(L: number, C: number, hDeg: number): [number, number, number] {
  const hRad = (hDeg * Math.PI) / 180
  const a = C * Math.cos(hRad)
  const b = C * Math.sin(hRad)
  return oklabToSrgb(L, a, b)
}

function oklabToSrgb(L: number, a: number, b: number): [number, number, number] {
  // OKLAB -> LMS (cubed)
  const lmsL = L + 0.3963377774 * a + 0.2158037573 * b
  const lmsM = L - 0.1055613458 * a - 0.0638541728 * b
  const lmsS = L - 0.0894841775 * a - 1.291485548 * b

  const linL = lmsL * lmsL * lmsL
  const linM = lmsM * lmsM * lmsM
  const linS = lmsS * lmsS * lmsS

  // linear LMS -> linear sRGB
  let r = +4.0767416621 * linL - 3.3077115913 * linM + 0.2309699292 * linS
  let g = -1.2684380046 * linL + 2.6097574011 * linM - 0.3413193965 * linS
  let bl = -0.0041960863 * linL - 0.7034186147 * linM + 1.707614701 * linS

  // gamma encode and clamp to [0, 1]
  return [clamp01(srgbEncode(r)), clamp01(srgbEncode(g)), clamp01(srgbEncode(bl))]
}

function srgbEncode(x: number): number {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
}

function clamp01(x: number): number {
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

function formatRgba(r: number, g: number, b: number, a: number): string {
  const R = Math.round(r * 255)
  const G = Math.round(g * 255)
  const B = Math.round(b * 255)
  if (a >= 1) return `rgb(${R}, ${G}, ${B})`
  // Three-decimal alpha keeps round-tripping legible without bloating
  // the inlined CSS.
  const A = Math.round(a * 1000) / 1000
  return `rgba(${R}, ${G}, ${B}, ${A})`
}
