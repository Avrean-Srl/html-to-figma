import type { IRBlendMode, IRShadow } from '../types/ir'

// IR shadows -> Figma Effect[]. Single point of conversion so frame
// and text can share the recipe.
//
// Branch on type because the Figma runtime validates effect keys against
// the variant: DropShadowEffect accepts showShadowBehindNode, but
// InnerShadowEffect rejects it ("unrecognized keys in object
// showShadowBehindNode"). A single bad entry fails the whole .effects
// assignment, which aborts the surrounding frame build.
export function buildShadowEffects(shadows: ReadonlyArray<IRShadow>): Effect[] {
  return shadows.map((s) => {
    const color = {
      r: s.color.r,
      g: s.color.g,
      b: s.color.b,
      a: s.color.a
    }
    const offset = { x: s.offsetX, y: s.offsetY }
    if (s.type === 'inner') {
      return {
        type: 'INNER_SHADOW',
        color,
        offset,
        radius: s.blur,
        spread: s.spread,
        visible: true,
        blendMode: 'NORMAL'
      } satisfies InnerShadowEffect
    }
    return {
      type: 'DROP_SHADOW',
      color,
      offset,
      radius: s.blur,
      spread: s.spread,
      visible: true,
      blendMode: 'NORMAL',
      showShadowBehindNode: false
    } satisfies DropShadowEffect
  })
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
