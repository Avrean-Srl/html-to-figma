// Intermediate Representation: pure JSON contract between parser (UI iframe)
// and mapper (main thread). Safe for structured clone via postMessage.
// Images use Uint8Array — structured clone preserves it.
// See PROJECT.md sec 3 for pipeline context, DECISIONS.md D1 for niche scope.

export type IRNode = IRFrame | IRText | IRImage | IRSvg

export interface IRNodeBase {
  id: string
  layout: IRLayout
  opacity: number
  hidden: boolean
  blendMode: IRBlendMode
}

// Matches CSS mix-blend-mode names. 1:1 mapping to Figma BlendMode
// enum (uppercase with underscores) at the mapper.
export type IRBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'

export interface IRLayout {
  x: number
  y: number
  width: number
  height: number
}

export interface IRFrame extends IRNodeBase {
  type: 'frame'
  sourceTag: string
  fills: IRFill[]
  cornerRadius: CornerRadius
  children: IRNode[]
  autoLayout: IRAutoLayout | null
  shadows: IRShadow[]
  stroke: IRStroke | null
}

export interface IRShadow {
  type: 'drop' | 'inner'
  offsetX: number
  offsetY: number
  blur: number
  spread: number
  color: IRColor
}

// Phase 3.1 supports uniform border only. Per-side borders (e.g.
// border-bottom only) need a workaround — deferred.
export interface IRStroke {
  color: IRColor
  width: number
}

export interface IRText extends IRNodeBase {
  type: 'text'
  characters: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  fontStyle: 'normal' | 'italic' | 'oblique'
  color: IRColor
  letterSpacing: number
  lineHeight: number
  textAlign: 'left' | 'right' | 'center' | 'justify'
  textDecoration: 'none' | 'underline' | 'line-through'
}

export interface IRImage extends IRNodeBase {
  type: 'image'
  sourceUrl: string
  bytes: Uint8Array | null
  loadStatus: ImageLoadStatus
  objectFit: 'fill' | 'contain' | 'cover' | 'none' | 'scale-down'
}

export interface IRSvg extends IRNodeBase {
  type: 'svg'
  svg: string
}

export interface IRFill {
  type: 'solid'
  color: IRColor
}

// 0-1 channels to match Figma API. Parser converts CSS rgb(0-255) at extraction time.
export interface IRColor {
  r: number
  g: number
  b: number
  a: number
}

// [topLeft, topRight, bottomRight, bottomLeft] in px.
export type CornerRadius = [number, number, number, number]

export interface IRAutoLayout {
  direction: 'horizontal' | 'vertical'
  gap: number
  padding: { top: number; right: number; bottom: number; left: number }
  primaryAxisAlign: 'min' | 'center' | 'max' | 'space-between'
  counterAxisAlign: 'min' | 'center' | 'max'
  wrap: boolean
}

export type ImageLoadStatus =
  | 'ok'
  | 'data-url'
  | 'cors-blocked'
  | 'network-error'
  | 'not-found'

export interface IRDocument {
  viewportWidth: number
  root: IRFrame
  fontsUsed: IRFontRef[]
  imageFailures: IRImageFailure[]
}

export interface IRFontRef {
  family: string
  weight: number
  style: 'normal' | 'italic' | 'oblique'
}

export interface IRImageFailure {
  sourceUrl: string
  reason: Exclude<ImageLoadStatus, 'ok' | 'data-url'>
}
