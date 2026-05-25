# Assets

Static visual assets for the plugin. Two categories:

1. **Community submission assets** (`community/`) — required by Figma when publishing
2. **Plugin UI assets** (`ui/`) — used inside the plugin's iframe

## Community submission (`assets/community/`)

Uploaded through the Figma Community publish form. Not bundled into `build/`.

| File | Spec | Notes |
|---|---|---|
| `icon.png` | 128×128 PNG, transparent background | Shown as the small thumbnail next to the plugin name in Community search results and on the plugin tile. |
| `cover.png` | 1920×960 PNG (2:1 ratio) | Hero image at the top of the plugin's Community listing page. Should communicate what the plugin does in one glance. |
| `screenshot-1.png` ... `screenshot-N.png` | Variable, recommend ≥ 1920 px wide | 4–8 screenshots showing the plugin in use: empty UI, UI with HTML loaded, canvas after import, image failures report, etc. |
| `demo.gif` (optional) | ≤ 30 s, ≤ 5 MB | Short loop showing paste-or-drop → click → Figma frame appearing on the canvas. |

These files are uploaded **at publish time**, not at plugin runtime. Figma desktop ignores anything in this folder.

## Plugin UI (`assets/ui/`)

Sources for the banner shown inside the plugin's iframe. The current banner is implemented as inline SVG in `src/ui/Banner.tsx`. If you want to swap it out:

**Option A — edit the SVG directly** (recommended, vector, tiny bundle):
1. Open `src/ui/Banner.tsx`
2. Replace the `<svg>...</svg>` block with your own SVG markup
3. Save — `pnpm watch` picks it up immediately

**Option B — drop in a PNG**:
1. Export your banner at 960×200 px (retina-ready for the 480 px UI width)
2. Save as `assets/ui/banner.png`
3. Convert to base64 (`base64 -w0 banner.png > banner.b64` on Linux/Mac, or any online tool)
4. In `src/ui/Banner.tsx`, replace the `<svg>` with:
   ```tsx
   <img
     src="data:image/png;base64,YOUR_BASE64_HERE"
     alt="HTML to Figma"
     style={{ display: 'block', width: '100%', height: 'auto' }}
   />
   ```
5. Optionally remove the surrounding gradient `<div>` styling if your PNG already includes its own background.
