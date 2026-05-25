import type { IRFill, IRGradient } from '../types/ir'

// Converts an IR fill into a Figma Paint. Centralized here so frame
// (and eventually image) builders share the conversion and the
// gradient-transform math.
export function fillToPaint(fill: IRFill): Paint {
  if (fill.type === 'solid') {
    return {
      type: 'SOLID',
      color: { r: fill.color.r, g: fill.color.g, b: fill.color.b },
      opacity: fill.color.a
    }
  }
  return gradientToPaint(fill.gradient)
}

function gradientToPaint(g: IRGradient): GradientPaint {
  return {
    type: g.kind === 'linear' ? 'GRADIENT_LINEAR' : 'GRADIENT_RADIAL',
    gradientTransform: g.kind === 'linear'
      ? linearTransform(g.angle)
      : radialTransform(),
    gradientStops: g.stops.map((s) => ({
      position: s.position,
      color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a }
    }))
  }
}

// CSS angle convention: 0deg = to top, 90 = to right, 180 = to bottom.
// Figma identity gradient runs left-to-right through the center.
// Mapping a CSS angle to a Figma rotation:
//   screen-CW θ = α - 90 (in degrees)
// The transform is a rotation by θ around the unit-square center (0.5, 0.5).
function linearTransform(cssAngleDeg: number): Transform {
  const θ = ((cssAngleDeg - 90) * Math.PI) / 180
  const c = Math.cos(θ)
  const s = Math.sin(θ)
  // Rotation around (0.5, 0.5):
  //   new_x = c * x - s * y + 0.5 * (1 - c) + 0.5 * s
  //   new_y = s * x + c * y - 0.5 * s + 0.5 * (1 - c)
  return [
    [c, -s, 0.5 * (1 - c) + 0.5 * s],
    [s, c, -0.5 * s + 0.5 * (1 - c)]
  ]
}

// CSS radial-gradient default extent is 'farthest-corner', which for
// a unit square is √(0.5² + 0.5²) = √2/2 ≈ 0.707. Identity Figma radial
// has major radius 0.5, so we scale by √2 around the center to match.
function radialTransform(): Transform {
  const s = Math.SQRT2
  const t = 0.5 * (1 - s)
  return [
    [s, 0, t],
    [0, s, t]
  ]
}
