import type { IRText } from '../types/ir'

import { mapBlendMode } from './effects'

// Builds a TextNode from an IRText. fontName must be assigned before
// characters per Figma API contract, and the font must already be
// loaded - the mapper orchestrator batch-loads via fonts.ts before
// calling this.
export function createTextFromIR(ir: IRText, fontName: FontName): TextNode {
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

  return text
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
