import type { IRFontRef } from '../types/ir'

const FALLBACK_FAMILY = 'Inter'
const FALLBACK_STYLE = 'Regular'
export const FALLBACK_FONT: FontName = {
  family: FALLBACK_FAMILY,
  style: FALLBACK_STYLE
}

// Maps a numeric CSS font-weight to a Figma style name. Italic is
// appended as a suffix (Bold Italic, Light Italic, ...) matching how
// Figma names its font variants.
export function weightToStyle(weight: number, italic: boolean): string {
  let base: string
  if (weight <= 100) base = 'Thin'
  else if (weight <= 200) base = 'ExtraLight'
  else if (weight <= 300) base = 'Light'
  else if (weight <= 400) base = 'Regular'
  else if (weight <= 500) base = 'Medium'
  else if (weight <= 600) base = 'SemiBold'
  else if (weight <= 700) base = 'Bold'
  else if (weight <= 800) base = 'ExtraBold'
  else base = 'Black'

  if (!italic) return base
  if (base === 'Regular') return 'Italic'
  return `${base} Italic`
}

export function refKey(ref: IRFontRef): string {
  return `${ref.family}|${ref.weight}|${ref.style}`
}

// Resolves every IR font reference to a concrete Figma FontName that is
// known to be available and batch-loads each unique (family, style)
// pair via figma.loadFontAsync. Cascade per ref:
//   1. requested family + computed style
//   2. requested family + Regular
//   3. Inter + computed style
//   4. Inter Regular
export async function resolveAndLoadFonts(
  refs: ReadonlyArray<IRFontRef>
): Promise<Map<string, FontName>> {
  const available = await figma.listAvailableFontsAsync()
  const availableSet = new Set(
    available.map((f) => `${f.fontName.family}|${f.fontName.style}`)
  )

  const has = (family: string, style: string): boolean =>
    availableSet.has(`${family}|${style}`)

  const resolved = new Map<string, FontName>()
  const toLoad = new Map<string, FontName>()

  for (const ref of refs) {
    const italic = ref.style === 'italic' || ref.style === 'oblique'
    const targetStyle = weightToStyle(ref.weight, italic)

    let chosen: FontName | null = null
    if (ref.family && has(ref.family, targetStyle)) {
      chosen = { family: ref.family, style: targetStyle }
    } else if (ref.family && has(ref.family, FALLBACK_STYLE)) {
      chosen = { family: ref.family, style: FALLBACK_STYLE }
    } else if (has(FALLBACK_FAMILY, targetStyle)) {
      chosen = { family: FALLBACK_FAMILY, style: targetStyle }
    } else {
      chosen = FALLBACK_FONT
    }

    resolved.set(refKey(ref), chosen)
    toLoad.set(`${chosen.family}|${chosen.style}`, chosen)
  }

  await Promise.all(
    Array.from(toLoad.values()).map((fontName) =>
      figma.loadFontAsync(fontName)
    )
  )

  // Always ensure the fallback itself is loaded so the mapper can use
  // it for any IRText whose font resolution failed at runtime.
  if (!toLoad.has(`${FALLBACK_FAMILY}|${FALLBACK_STYLE}`)) {
    await figma.loadFontAsync(FALLBACK_FONT)
  }

  return resolved
}

export function resolveFont(
  resolved: Map<string, FontName>,
  ref: IRFontRef
): FontName {
  return resolved.get(refKey(ref)) ?? FALLBACK_FONT
}
