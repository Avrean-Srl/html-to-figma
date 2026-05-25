# Support matrix

What is supported, partially supported, and not supported by the HTML to Figma plugin. Updated alongside the codebase — if a feature lands or is deferred, this document is updated in the same commit.

**Legend**
- ✅ Supported and exercised by tests / fixtures
- ⚠️ Partially supported (works in common cases, has known edge-case limitations)
- ❌ Not supported (silently dropped; layout space may or may not be preserved depending on the case)

## Layout & positioning

| Feature | Status | Notes |
|---|---|---|
| `display: block`, `inline`, `inline-block` | ✅ | Children positioned absolutely from `getBoundingClientRect`. |
| `display: flex`, `inline-flex` | ✅ | Mapped to Figma Auto Layout (`HORIZONTAL` / `VERTICAL`). |
| `display: grid` | ⚠️ | Layout captured as absolute positions; no Figma Grid Layout equivalent. |
| `flex-direction` (row/column) | ✅ | `row-reverse` and `column-reverse` collapse to forward. |
| `justify-content` | ✅ | `space-around` and `space-evenly` approximate to `SPACE_BETWEEN`. |
| `align-items` | ✅ | `stretch` collapses to `MIN` (counter-axis stays `FIXED`). |
| `gap` / `row-gap` / `column-gap` | ✅ | Read per direction. |
| `flex-wrap` | ✅ | Maps to Figma `layoutWrap`. |
| `position: static`, `relative`, `absolute`, `fixed`, `sticky` | ✅ | All collapse to the rendered position in the iframe; Figma node is placed there. |
| `z-index` | ✅ | Siblings sorted ascending; stable sort preserves source order for ties. |
| `overflow: hidden` / `clip` | ✅ | Mapped to Figma `clipsContent`. |
| `padding` | ✅ | All four sides; honored inside Auto Layout. |
| `margin` | ✅ | Captured indirectly via the child's measured position. |
| `transform: translate(...)` | ✅ | Already included in the bounding rect. |
| `transform: rotate / scale / skew` | ❌ | Bounding rect of a rotated element is its AABB, so direct mapping would misplace it. Deferred. |

## Typography

| Feature | Status | Notes |
|---|---|---|
| `font-family` | ✅ | First family in the stack used. Falls back to Inter if not available in Figma. |
| `font-size` | ✅ | Pixel value. |
| `font-weight` | ✅ | Numeric weight mapped to Figma style names (`Regular`, `Bold`, ...). |
| `font-style: italic / oblique` | ✅ | Suffixes the Figma style name (`Bold Italic`). |
| `color` | ✅ | Solid SOLID fill. |
| `line-height` | ✅ | Resolved to pixels. `normal` → `fontSize × 1.2`. |
| `letter-spacing` | ✅ | Pixel value. |
| `text-align` | ✅ | left/right/center/justify. |
| `text-decoration` | ✅ | underline → `UNDERLINE`, line-through → `STRIKETHROUGH`. |
| `text-shadow` | ❌ | Deferred. |
| `text-transform`, `white-space`, `word-break`, `hyphens` | ❌ | Deferred. |
| Pseudo-elements `::before` / `::after` | ❌ | Content from generated boxes is not synthesized into IR nodes. |

## Color, fill, blend

| Feature | Status | Notes |
|---|---|---|
| `background-color` | ✅ | Solid SOLID fill. Alpha preserved as fill opacity. |
| `linear-gradient(...)` | ✅ | Any CSS angle (`deg` / `rad` / `grad` / `turn`) and `to <direction>` keywords. |
| `radial-gradient(...)` | ✅ | Centered, farthest-corner extent approximation. |
| `conic-gradient`, repeating gradients | ❌ | Not supported. |
| Multi-stop gradients with explicit positions | ✅ | Missing positions are linearly interpolated. |
| `opacity` | ✅ | Applied to node `opacity`. |
| `mix-blend-mode` | ✅ | All 15 CSS keywords mapped 1:1 to Figma `BlendMode`. |
| `background-blend-mode` | ❌ | Not parsed. |

## Borders, corners, effects

| Feature | Status | Notes |
|---|---|---|
| `border-radius` (uniform) | ✅ | |
| `border-radius` per corner | ✅ | top-left / top-right / bottom-right / bottom-left independent. |
| `border` (uniform) | ✅ | Single SOLID stroke with `strokeAlign: INSIDE`. |
| `border` per-side (e.g. `border-bottom`) | ❌ | Figma has no per-side stroke. Workaround (synthetic thin frames) deferred. |
| `border-style: dashed / dotted` | ❌ | All strokes render solid. |
| `box-shadow` (single and multiple) | ✅ | Multiple comma-separated shadows preserved in order. |
| `box-shadow: inset` | ✅ | Maps to `INNER_SHADOW`. |
| `box-shadow: spread` | ✅ | |
| `filter`, `backdrop-filter` | ❌ | Deferred. |

## Images and media

| Feature | Status | Notes |
|---|---|---|
| `<img>` with `data:` URL (PNG, JPEG, GIF) | ✅ | Decoded in process. SVG / WebP / AVIF data URLs are rejected as `format-unsupported` and a placeholder is rendered. |
| `<img>` with absolute `https?:` URL | ✅ | Fetched in the plugin iframe. CORS, 404, network errors land in the post-import failure list with a placeholder in the canvas. |
| `<img>` with relative URL | ⚠️ | Resolved against the plugin iframe origin, which is not the user's site — typically fails as `not-found`. |
| `srcset`, `<picture>`, `<source>` | ❌ | Only `src` is read. |
| `background-image: url(...)` raster | ❌ | Gradients work; URL backgrounds deferred. |
| `<svg>` inline | ✅ | Routed through `figma.createNodeFromSvg`. Text inside SVG becomes vector paths, not editable text. |
| `object-fit` | ✅ | `cover` → FILL (crops). `contain` / `scale-down` → FIT. `fill` / `none` approximated to FILL. |
| `<video>`, `<audio>`, `<canvas>`, `<iframe>`, `<object>`, `<embed>` | ❌ | Skipped entirely. |

## Forms and interactive elements

| Feature | Status | Notes |
|---|---|---|
| `<input>`, `<textarea>`, `<select>`, `<button>`, `<form>` | ❌ | Skipped. Forms are usually re-designed inside Figma anyway. |
| `:hover`, `:focus`, `:active`, `:checked` pseudo-classes | ❌ | Only the resting computed style is captured. |

## Document-level

| Feature | Status | Notes |
|---|---|---|
| Full HTML document (`<html><head><body>`) | ⚠️ | `innerHTML` strips outer html/head wrappers; `<style>` content in head is honored because it cascades when the rendered tree is attached. |
| External stylesheets `<link rel="stylesheet">` | ❌ | Blocked by CORS in the plugin iframe in practice. |
| Inline `<style>` blocks | ✅ | Applied to the rendered tree before walking. |
| HTML comments | ✅ | Stripped by `innerHTML` parsing. |

## Input formats

| Input | Status | Notes |
|---|---|---|
| Paste HTML in the textarea | ✅ | The "Paste" tab. |
| Drop a `.html` / `.htm` file | ✅ | The "File" tab. File contents read via `FileReader`. |
| Drop a `.zip` archive | ✅ | The "File" tab. `index.html` (or first `.html`) is extracted; relative `<img src="...">` paths are inlined as data URLs from the archive's image assets. CSS `url(...)` references and `<link rel="stylesheet">` inside the archive are not yet resolved. |

## Performance limits

| Feature | Status | Notes |
|---|---|---|
| Small documents (<500 nodes) | ✅ | Sub-second on typical hardware. |
| Large documents (>500 nodes) | ⚠️ | Works but no node-creation batching yet; UI thread may stall briefly. Progress events emit every 25 nodes so the user sees movement. |
| Plugin UI style pollution from user CSS | ⚠️ | The user's `<style>` cascades to the plugin UI while the hidden render container is mounted (typically <100 ms). See DECISIONS.md D7. |
