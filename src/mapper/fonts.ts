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

// Figma font style names are not spelled consistently across families:
// Inter ships "Semi Bold" / "Extra Light" / "Extra Bold" (with spaces),
// while many other families use "SemiBold" / "ExtraLight" (no spaces),
// and casing varies too. weightToStyle emits the no-space canonical
// form, so a literal `Set.has('Inter|SemiBold')` misses Inter's real
// "Semi Bold" and the whole weight silently falls back to Regular.
// Normalizing (lowercase, strip spaces) before comparison makes the
// match resilient to both spellings.
function normalizeStyle(style: string): string {
  return style.toLowerCase().replace(/\s+/g, '')
}

// Resolves every IR font reference to a concrete Figma FontName that is
// known to be available and batch-loads each unique (family, style)
// pair via figma.loadFontAsync. Cascade per ref:
//   1. requested family + computed style
//   2. requested family + Regular
//   3. Inter + computed style
//   4. Inter Regular
// Indexes a loaded set of fonts by `${family}|${style}` and exposes
// FontName lookups for the runtime mapping. resolveAndLoadFonts both
// loads and returns this map; resolveFont reads it.
export type FontMap = Map<string, FontName>

export async function resolveAndLoadFonts(
  refs: ReadonlyArray<IRFontRef>
): Promise<FontMap> {
  const available = await figma.listAvailableFontsAsync()
  // Index available fonts by `${family}|${normalizedStyle}` -> the real
  // FontName (with Figma's exact spelling, which loadFontAsync needs).
  const availableIndex = new Map<string, FontName>()
  for (const f of available) {
    availableIndex.set(
      `${f.fontName.family}|${normalizeStyle(f.fontName.style)}`,
      f.fontName
    )
  }

  // Returns the actual available FontName for (family, desiredStyle),
  // matched case/space-insensitively, or null if the family doesn't
  // ship that style.
  const lookup = (family: string, style: string): FontName | null =>
    availableIndex.get(`${family}|${normalizeStyle(style)}`) ?? null

  const resolved = new Map<string, FontName>()
  const toLoad = new Map<string, FontName>()

  for (const ref of refs) {
    const italic = ref.style === 'italic' || ref.style === 'oblique'
    const targetStyle = weightToStyle(ref.weight, italic)

    let chosen: FontName | null = null
    if (ref.family) chosen = lookup(ref.family, targetStyle)
    if (chosen === null && ref.family) {
      chosen = lookup(ref.family, FALLBACK_STYLE)
    }
    if (chosen === null) chosen = lookup(FALLBACK_FAMILY, targetStyle)
    if (chosen === null) chosen = FALLBACK_FONT

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
