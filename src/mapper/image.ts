import type { IRImage } from '../types/ir'

import { mapBlendMode } from './effects'

// Builds a RectangleNode with an ImagePaint fill. CSS object-fit maps
// to Figma scaleMode: cover -> FILL (crops), contain -> FIT (letterbox),
// fill/none/scale-down approximated to FILL (Figma has no direct stretch).
//
// When IRImage.bytes is null (CORS / network failure) the rectangle is
// rendered as a placeholder grey box so layout is preserved — the UI
// reports the failed URLs separately so the user can fix them manually.
export function createImageFromIR(ir: IRImage): RectangleNode {
  const rect = figma.createRectangle()
  rect.name = ir.bytes === null ? '[image failed]' : 'img'
  rect.resize(
    Math.max(ir.layout.width, 0.01),
    Math.max(ir.layout.height, 0.01)
  )
  rect.opacity = ir.opacity

  if (ir.bytes !== null) {
    try {
      const img = figma.createImage(ir.bytes)
      rect.fills = [
        {
          type: 'IMAGE',
          imageHash: img.hash,
          scaleMode: mapObjectFit(ir.objectFit)
        }
      ]
    } catch {
      // Belt-and-suspenders: loadImages should have caught unsupported
      // formats via magic-number sniffing, but Figma occasionally
      // rejects bytes that pass the sniff (truncated PNGs, exotic JPEG
      // variants, etc.). Don't let a single bad image kill the whole
      // import — render the placeholder instead.
      rect.name = '[image format unsupported]'
      rect.fills = [
        { type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 }, opacity: 1 }
      ]
    }
  } else {
    // Placeholder grey — keeps layout box visible.
    rect.fills = [
      {
        type: 'SOLID',
        color: { r: 0.9, g: 0.9, b: 0.9 },
        opacity: 1
      }
    ]
  }

  if (ir.blendMode !== 'normal') {
    rect.blendMode = mapBlendMode(ir.blendMode)
  }

  return rect
}

function mapObjectFit(
  v: IRImage['objectFit']
): 'FILL' | 'FIT' | 'CROP' | 'TILE' {
  switch (v) {
    case 'contain':
    case 'scale-down':
      return 'FIT'
    case 'cover':
      return 'FILL'
    // CSS 'none' and 'fill' don't map cleanly to Figma. 'none' would need
    // an identity transform via CROP; 'fill' would need stretch which
    // Figma doesn't expose directly. Both fall through to FILL — the
    // closest visual behavior that preserves the image inside the box.
    default:
      return 'FILL'
  }
}
