import type { IRText, IRTextRange } from '../types/ir'

import { mapBlendMode } from './effects'
import { resolveFont } from './fonts'
import type { FontMap } from './fonts'

// Builds a TextNode from an IRText. fontName must be assigned before
// characters per Figma API contract, and the font must already be
// loaded - the mapper orchestrator batch-loads via fonts.ts before
// calling this. When `ir.ranges` is present we apply per-character
// style overrides (bold strong / italic em / colored links) via
// `setRangeFontName` and `setRangeFills`, which keeps inline-phrase
// runs as one editable text layer instead of fragmenting.
export function createTextFromIR(
  ir: IRText,
  fontName: FontName,
  fontMap?: FontMap
): TextNode {
  const text = figma.createText()
  text.fontName = fontName
  text.characters = ir.characters
  text.fontSize = Math.max(ir.fontSize, 1)

  // Width sizing: the iframe measured the text in its default font,
  // Figma renders it in Inter (or whatever fontName resolved to).
  // Font metric differences shift text width by a few percent, which
  // causes single-line text to wrap unexpectedly. To avoid that we
  // detect line count from layout height vs line-height and let Figma
  // autosize single-line text. Multi-line text keeps a fixed width
  // (with a small buffer) so the wrapping pattern stays roughly the
  // same as in the source.
  const effectiveLineHeight =
    ir.lineHeight > 0 ? ir.lineHeight : ir.fontSize * 1.2
  const visualLines = Math.max(
    1,
    Math.round(ir.layout.height / effectiveLineHeight)
  )
  if (visualLines === 1) {
    text.textAutoResize = 'WIDTH_AND_HEIGHT'
  } else {
    text.textAutoResize = 'HEIGHT'
    text.resize(
      Math.max(ir.layout.width + 4, 1),
      Math.max(ir.layout.height, 1)
    )
  }

  text.fills = [
    {
      type: 'SOLID',
      color: { r: ir.color.r, g: ir.color.g, b: ir.color.b },
      opacity: ir.color.a
    }
  ]
  text.opacity = ir.opacity

  if (ir.letterSpacing !== 0) {
    text.letterSpacing = { value: ir.letterSpacing, unit: 'PIXELS' }
  }

  if (ir.lineHeight > 0) {
    text.lineHeight = { value: ir.lineHeight, unit: 'PIXELS' }
  }

  text.textAlignHorizontal = mapTextAlign(ir.textAlign)

  if (ir.textDecoration === 'underline') {
    text.textDecoration = 'UNDERLINE'
  } else if (ir.textDecoration === 'line-through') {
    text.textDecoration = 'STRIKETHROUGH'
  }

  if (ir.blendMode !== 'normal') {
    text.blendMode = mapBlendMode(ir.blendMode)
  }

  if (ir.ranges && ir.ranges.length > 0 && fontMap) {
    applyTextRanges(text, ir, fontName, fontMap)
  }

  return text
}

// Applies per-range style overrides on top of the base font / color
// already set on the text node. Each range carries a half-open
// [start, end) interval and optional weight / style / color /
// decoration. Out-of-range slices are silently skipped.
function applyTextRanges(
  text: TextNode,
  ir: IRText,
  baseFontName: FontName,
  fontMap: FontMap
): void {
  const len = ir.characters.length
  if (!ir.ranges) return
  for (const r of ir.ranges) {
    const start = Math.max(0, Math.min(r.start, len))
    const end = Math.max(start, Math.min(r.end, len))
    if (end <= start) continue

    // Font swap. The orchestrator already loaded any font referenced
    // by the rich-text walker (fontRefsCollected pushed every variant),
    // so the lookup in fontMap is hit-or-miss only if the rare
    // <strong italic> combo wasn't seen up front. In that case fall
    // back to the base font.
    if (r.fontWeight !== undefined || r.fontStyle !== undefined) {
      const rangeFont = resolveFont(fontMap, {
        family: baseFontName.family,
        weight: r.fontWeight ?? ir.fontWeight,
        style: r.fontStyle ?? ir.fontStyle
      })
      try {
        text.setRangeFontName(start, end, rangeFont)
      } catch {
        // If the per-range font isn't loaded (e.g. exotic weight),
        // leaving the range at the base font is acceptable - the
        // visible glyphs are still the right characters, just not
        // styled.
      }
    }

    if (r.color) {
      try {
        text.setRangeFills(start, end, [
          {
            type: 'SOLID',
            color: { r: r.color.r, g: r.color.g, b: r.color.b },
            opacity: r.color.a
          }
        ])
      } catch {
        // ignore - range may have been out of bounds after font swap
      }
    }

    if (r.textDecoration && r.textDecoration !== 'none') {
      try {
        text.setRangeTextDecoration(
          start,
          end,
          r.textDecoration === 'underline' ? 'UNDERLINE' : 'STRIKETHROUGH'
        )
      } catch {
        // ignore
      }
    }
  }
}

function mapTextAlign(
  ta: IRText['textAlign']
): 'LEFT' | 'RIGHT' | 'CENTER' | 'JUSTIFIED' {
  switch (ta) {
    case 'left':
      return 'LEFT'
    case 'right':
      return 'RIGHT'
    case 'center':
      return 'CENTER'
    case 'justify':
      return 'JUSTIFIED'
  }
}
