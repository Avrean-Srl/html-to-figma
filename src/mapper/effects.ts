import type { IRBlendMode, IRShadow } from '../types/ir'

// IR shadows -> Figma Effect[]. Single point of conversion so frame
// and text can share the recipe.
export function buildShadowEffects(shadows: ReadonlyArray<IRShadow>): Effect[] {
  return shadows.map((s) => ({
    type: s.type === 'inner' ? 'INNER_SHADOW' : 'DROP_SHADOW',
    color: {
      r: s.color.r,
      g: s.color.g,
      b: s.color.b,
      a: s.color.a
    },
    offset: { x: s.offsetX, y: s.offsetY },
    radius: s.blur,
    spread: s.spread,
    visible: true,
    blendMode: 'NORMAL',
    showShadowBehindNode: false
  }))
}

// CSS mix-blend-mode -> Figma BlendMode. 'normal' is the only case we
// skip - the caller decides not to touch the node's blendMode then.
export function mapBlendMode(m: IRBlendMode): BlendMode {
  switch (m) {
    case 'multiply':
      return 'MULTIPLY'
    case 'screen':
      return 'SCREEN'
    case 'overlay':
      return 'OVERLAY'
    case 'darken':
      return 'DARKEN'
    case 'lighten':
      return 'LIGHTEN'
    case 'color-dodge':
      return 'COLOR_DODGE'
    case 'color-burn':
      return 'COLOR_BURN'
    case 'hard-light':
      return 'HARD_LIGHT'
    case 'soft-light':
      return 'SOFT_LIGHT'
    case 'difference':
      return 'DIFFERENCE'
    case 'exclusion':
      return 'EXCLUSION'
    case 'hue':
      return 'HUE'
    case 'saturation':
      return 'SATURATION'
    case 'color':
      return 'COLOR'
    case 'luminosity':
      return 'LUMINOSITY'
    case 'normal':
      return 'NORMAL'
  }
}
