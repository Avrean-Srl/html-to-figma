# In-plugin UI assets

Sources for graphics shown inside the plugin's iframe. The current banner lives in `src/ui/Banner.tsx` as inline SVG - see two ways to swap it below.

## Replacing the banner (vector path - recommended)

1. Design your banner in Figma (or any vector tool).
2. **Constraints**: keep it ≤ 480 px wide (the plugin UI width). Recommended height 80–120 px. Use brand colors that read on both Figma's dark and light UI themes - or paint your own background within the banner.
3. Export as **SVG**.
4. Open `src/ui/Banner.tsx`.
5. Replace the entire `<svg>...</svg>` block with your exported SVG markup. Preserve the wrapping `<div>` if you want the existing gradient padding background, or drop it for an edge-to-edge banner.
6. `pnpm watch` rebuilds; in Figma desktop, reopen the plugin to see the change.

## Replacing the banner (raster path)

If you want a PNG / JPG (e.g. with a photo or gradient that's hard to do in SVG):

1. Export at **960 × 200 px** (retina-ready for the 480 px UI).
2. Save as `assets/ui/banner.png`.
3. Convert to base64 - any of:
   - `base64 -w0 banner.png` on Linux/Mac
   - `[Convert]::ToBase64String([IO.File]::ReadAllBytes("banner.png"))` in PowerShell
   - An online encoder
4. In `src/ui/Banner.tsx`, replace the `<svg>...</svg>` markup with:
   ```tsx
   <img
     src="data:image/png;base64,PASTE_BASE64_HERE"
     alt="HTML to Figma"
     style={{ display: 'block', width: '100%', height: 'auto' }}
   />
   ```
5. Optionally remove the surrounding gradient `<div>` styling if your image carries its own background.

Bundle impact: a 50 KB PNG → ~67 KB base64 (33% overhead). Acceptable but the SVG path is cheaper.

## Keeping the source

If you replace the banner, please also drop the source file (`.fig`, `.svg`, `.png`) in this folder so future designers can iterate on it without re-creating from scratch.
