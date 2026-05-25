# Community submission assets

Drop these files here before publishing to the Figma Community. None of them ship in `build/` — Figma reads them at publish time through its web form.

## Required

### icon.png

- **Size**: 128 × 128 px
- **Format**: PNG with transparent background (preferred)
- **Content**: a recognizable, scale-stable mark. The icon is shown at 32-64 px in most contexts, so detail beyond that is wasted.
- **Suggested**: the `</>` + arrow + Figma-square motif from the in-plugin banner, simplified for the small canvas.

### cover.png

- **Size**: 1920 × 960 px (2:1)
- **Format**: PNG, no transparency
- **Content**: communicates the value prop in one glance. Recommended composition: a stylized HTML snippet on the left, an arrow, the same content as Figma frames on the right. Brand colors. No tiny text — it'll be rendered as a thumbnail in many places.

## Optional but recommended

### screenshot-1.png ... screenshot-N.png

- 4–8 images
- ≥ 1920 px on the long edge
- PNG, no transparency
- Show: empty plugin UI, plugin with HTML loaded, canvas right after import, image-failure report, ZIP drop interaction

### demo.gif

- ≤ 30 s
- ≤ 5 MB (Community has a size cap)
- Show the full happy path: open plugin → paste HTML → click Import → frame appears on canvas

## Naming

Stick to lowercase, hyphens, no spaces. Examples:

```
icon.png
cover.png
screenshot-1-empty.png
screenshot-2-paste.png
screenshot-3-result.png
screenshot-4-image-failures.png
screenshot-5-zip-drop.png
demo.gif
```

## Verifying

After dropping files here, just `git add` them — they're plain assets, no build step. The next `pnpm build` won't touch them. When you submit to Community, upload each one in the corresponding slot of the form.
