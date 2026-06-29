// Intermediate Representation: pure JSON contract between parser (UI iframe)
// and mapper (main thread). Safe for structured clone via postMessage.
// Images use Uint8Array - structured clone preserves it.
// See PROJECT.md sec 3 for pipeline context, DECISIONS.md D1 for niche scope.

export type IRNode = IRFrame | IRText | IRImage | IRSvg

export interface IRNodeBase {
  id: string
  layout: IRLayout
  opacity: number
  hidden: boolean
  blendMode: IRBlendMode
  // CSS z-index. 'auto' becomes 0. Mapper sorts siblings ascending so
  // higher z-index ends up later in Figma's child list (= on top).
  zIndex: number
  // CSS flex-grow on a child of a flex container. Maps to Figma's
  // FrameNode.layoutGrow (1 = stretches along parent's primary axis,
  // 0 = stays at intrinsic size). Only meaningful when the parent has
  // autoLayout != null. Optional - defaults to 0 in the mapper if
  // missing, which keeps every existing IR fixture / test compatible.
  layoutGrow?: number
  // Cross-axis fill behavior for a child of a flex container. Maps to
  // Figma's layoutAlign: 'STRETCH' tells the child to fill the parent's
  // counter axis (e.g. sidebar links spanning the full sidebar width).
  // Translated from CSS `align-self: stretch` (or parent
  // `align-items: stretch` + child has no explicit cross-axis size).
  // Defaults to 'INHERIT' when missing. NOTE: 'MIN'/'CENTER'/'MAX' are
  // deprecated no-ops in Figma's current API - per-child counter-axis
  // alignment is gone; counter alignment lives on the PARENT frame via
  // IRAutoLayout.counterAxisAlign and applies to ALL children. So this
  // field only ever carries STRETCH.
  layoutAlign?: 'INHERIT' | 'STRETCH'
  // CSS position: 'absolute' / 'fixed' on a child of an Auto Layout
  // parent. Maps to Figma's layoutPositioning='ABSOLUTE' so the child
  // is taken OUT of the auto-layout flow and lands at its measured
  // x/y instead of being packed by the parent's primaryAxis order.
  // Defaults to 'auto'.
  positioning?: 'auto' | 'absolute'
  // For absolute children that should fill their containing block
  // (CSS `inset: 0` / `top:0; right:0; bottom:0; left:0`), apply
  // Figma's "stretch" constraints on both axes so the child resizes
  // with the parent. Without this, the inset-0 pseudo stays at a
  // fixed measured size and overflows when the parent grows.
  constraintsStretch?: { horizontal: boolean; vertical: boolean }
  // Internal navigation target captured from an <a href="..."> that became
  // its OWN node (nav link, CTA button, clickable card). Preserved raw
  // from the HTML attribute. The mapper surfaces every node carrying this
  // and main.ts resolves the href to a sibling page frame to wire a Figma
  // prototype reaction (ON_CLICK -> NAVIGATE). Absent on non-link nodes.
  // Inline <a> merged into a paragraph's text ranges do NOT carry this -
  // they have no standalone node to attach a reaction to.
  linkHref?: string
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
  // CSS overflow hidden / overflow-x hidden / overflow-y hidden -> true.
  // Mapped to FrameNode.clipsContent.
  clipsContent: boolean
}

export interface IRShadow {
  type: 'drop' | 'inner'
  offsetX: number
  offsetY: number
  blur: number
  spread: number
  color: IRColor
}

// Borders. `width` is the uniform stroke weight (kept for the common
// all-sides-equal case and as a fallback). `sides` carries per-side
// weights when the CSS declares an asymmetric border (e.g. border-top
// only, or a divider with border-bottom). Figma frames support
// individual stroke weights (strokeTopWeight / strokeRightWeight /
// strokeBottomWeight / strokeLeftWeight) but only ONE stroke paint, so
// the color/style are shared across whichever sides are non-zero.
export interface IRStroke {
  color: IRColor
  width: number
  // Per-side weights in px. Present only when the border is NOT uniform.
  // When omitted, `width` applies to all four sides.
  sides?: { top: number; right: number; bottom: number; left: number }
  // CSS border-style. Maps to Figma's dashPattern: solid -> [],
  // dashed -> [8, 4], dotted -> [stroke-width, stroke-width].
  style: 'solid' | 'dashed' | 'dotted'
}

// Sizing hint a flex container declares for its own axes. Used by the
// mapper to pick primaryAxisSizingMode / counterAxisSizingMode:
//   - 'fixed': preserve the iframe-measured dimension (default for
//     block-level flex, where CSS gives the container a defined width)
//   - 'hug':   shrink to children + gap + padding. Right for
//     `display: inline-flex` and content-sized chips/buttons.
export type IRSizingHint = 'fixed' | 'hug'

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
  // Per-character style overrides for inline-phrase children (strong,
  // em, b, i, mark, etc.). When set, the mapper calls
  // setRangeFontName / setRangeFills / setRangeTextDecoration on the
  // Figma TextNode so a single sentence with embedded bold / italic
  // / colored runs lands as ONE text layer instead of getting
  // fragmented into separate Figma frames.
  ranges?: IRTextRange[]
}

export interface IRTextRange {
  // Half-open character interval [start, end) in IRText.characters.
  start: number
  end: number
  fontWeight?: number
  fontStyle?: 'normal' | 'italic' | 'oblique'
  color?: IRColor
  textDecoration?: 'none' | 'underline' | 'line-through'
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

export type IRFill = IRSolidFill | IRGradientFill

export interface IRSolidFill {
  type: 'solid'
  color: IRColor
}

export interface IRGradientFill {
  type: 'gradient'
  gradient: IRGradient
}

export interface IRGradient {
  // 'linear' and 'radial' are mapped to Figma's GRADIENT_LINEAR /
  // GRADIENT_RADIAL. Conic/diamond deferred.
  kind: 'linear' | 'radial'
  // CSS angle in degrees (0 = to top, 90 = to right, 180 = to bottom,
  // 270 = to left). Ignored for radial (always centered, farthest-corner).
  angle: number
  stops: IRGradientStop[]
}

export interface IRGradientStop {
  // Normalized 0-1.
  position: number
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
  // How the container itself sizes along each axis. Defaults to 'fixed'
  // on both (= pin to measured rect), but `display: inline-flex` and a
  // few other CSS shapes legitimately want 'hug'. Optional so existing
  // IR fixtures still parse.
  primaryAxisSizing?: IRSizingHint
  counterAxisSizing?: IRSizingHint
}

export type ImageLoadStatus =
  | 'pending'
  | 'ok'
  | 'data-url'
  | 'cors-blocked'
  | 'network-error'
  | 'not-found'
  | 'format-unsupported'

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
  reason: Exclude<ImageLoadStatus, 'ok' | 'data-url' | 'pending'>
}
