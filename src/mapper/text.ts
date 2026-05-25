import type { IRText } from '../types/ir'

// Builds a TextNode from an IRText. fontName must be assigned before
// characters per Figma API contract, and the font must already be
// loaded — the mapper orchestrator batch-loads via fonts.ts before
// calling this.
export function createTextFromIR(ir: IRText, fontName: FontName): TextNode {
  const text = figma.createText()
  text.fontName = fontName
  text.characters = ir.characters
  text.fontSize = Math.max(ir.fontSize, 1)

  // Width keeps the text from collapsing to natural width when the
  // source had wrapping. Figma autosizes height to fit by default.
  text.resize(Math.max(ir.layout.width, 1), Math.max(ir.layout.height, 1))

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
