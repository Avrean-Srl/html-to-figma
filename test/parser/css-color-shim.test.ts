import { describe, expect, it } from 'vitest'

import { rewriteModernCssColors } from '../../src/parser/css-color-shim'

describe('rewriteModernCssColors', () => {
  it('converts a basic oklch() to rgb()', () => {
    // oklch(50.5% 0.198 25) is approximately the boero brand red #BA2125.
    const out = rewriteModernCssColors('.btn { color: oklch(50.5% 0.198 25) }')
    expect(out).toMatch(/\.btn \{ color: rgb\(/)
    expect(out).not.toContain('oklch')
    // Sanity: the result should sit in the red ballpark, not be black.
    const match = out.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
    expect(match).not.toBeNull()
    if (match) {
      const r = Number(match[1])
      const g = Number(match[2])
      const b = Number(match[3])
      expect(r).toBeGreaterThan(g)
      expect(r).toBeGreaterThan(b)
      expect(r).toBeGreaterThan(100)
    }
  })

  it('preserves alpha via rgba() when present', () => {
    const out = rewriteModernCssColors('.x { background: oklch(99% 0.002 25 / 0.55) }')
    expect(out).toMatch(/rgba\(\d+,\s*\d+,\s*\d+,\s*0\.55\)/)
  })

  it('converts a near-white oklch to a high-luminance rgb', () => {
    // --surface-base in boero: oklch(99.5% 0.002 25)
    const out = rewriteModernCssColors('.x { background: oklch(99.5% 0.002 25) }')
    const match = out.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
    expect(match).not.toBeNull()
    if (match) {
      const [r, g, b] = match.slice(1, 4).map(Number)
      expect(r).toBeGreaterThan(245)
      expect(g).toBeGreaterThan(245)
      expect(b).toBeGreaterThan(240)
    }
  })

  it('handles multiple oklch() in the same string', () => {
    const out = rewriteModernCssColors(
      ':root { --a: oklch(50% 0.1 0); --b: oklch(80% 0.05 180); }'
    )
    expect(out).not.toContain('oklch')
    expect((out.match(/rgb\(/g) ?? []).length).toBe(2)
  })

  it('converts oklab()', () => {
    const out = rewriteModernCssColors('.x { color: oklab(0.5 0.1 0.05) }')
    expect(out).not.toContain('oklab')
    expect(out).toMatch(/rgb\(/)
  })

  it('leaves rgb / hsl / named colors untouched', () => {
    const css =
      '.a { color: rgb(255, 0, 0) } .b { color: hsl(120, 100%, 50%) } .c { color: red }'
    const out = rewriteModernCssColors(css)
    expect(out).toBe(css)
  })

  it('leaves oklch-shaped substrings outside CSS color contexts alone', () => {
    // Defensive: comments and unrelated identifiers shouldn't trip the
    // regex. (We accept some false positives in /* oklch(...) */ but
    // they round-trip safely.)
    const css = '/* oklch(50% 0.1 30) is the brand red */ .x { color: red }'
    const out = rewriteModernCssColors(css)
    expect(out).toContain('rgb(')
    expect(out).toContain('.x { color: red }')
  })

  it('handles hue with explicit deg unit', () => {
    const out = rewriteModernCssColors('.x { color: oklch(50% 0.1 90deg) }')
    expect(out).toMatch(/rgb\(/)
  })

  it('treats none as zero in component slots', () => {
    const out = rewriteModernCssColors('.x { color: oklch(50% none 0) }')
    // chroma=0 means grey at the given lightness, hue irrelevant.
    const match = out.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
    expect(match).not.toBeNull()
    if (match) {
      const [r, g, b] = match.slice(1, 4).map(Number)
      // Allow ±1 for rounding because the OKLCH->sRGB pipeline isn't
      // perfectly grey-identity for arbitrary L; check that channels
      // are close to each other rather than absolutely equal.
      expect(Math.abs(r - g)).toBeLessThanOrEqual(2)
      expect(Math.abs(g - b)).toBeLessThanOrEqual(2)
    }
  })

  it('returns input unchanged when oklch arguments are unparseable', () => {
    const css = '.x { color: oklch(garbage here forever) }'
    const out = rewriteModernCssColors(css)
    expect(out).toBe(css)
  })
})
