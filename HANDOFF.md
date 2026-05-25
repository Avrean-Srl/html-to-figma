# Handoff

Self-contained snapshot of the project. Read this top to bottom before resuming work. Replaces the old PROJECT.md / DECISIONS.md / SUPPORT_MATRIX.md split (deleted to reduce drift).

---

## 1. What this is

A free Figma plugin that converts HTML + CSS into native Figma nodes (frames, text, images, Auto Layout, fills, gradients, shadows, borders). Optimized for the Tailwind / shadcn / utility-first niche.

- Repo: `https://github.com/Avrean-Srl/html-to-figma`
- Local path on owner's machine: `C:\Users\avrea\Desktop\Lavoro\Progetti\HTML-to-Figma`
- Owner: Edoardo / Redergo
- Status: implementation complete. 128/128 tests green. Ready for Figma Community submission once visual assets land (cover image, screenshots, demo GIF).
- Niche: locked to Tailwind / shadcn / utility-first HTML, not generic web pages, not email. This drives every implementation tradeoff.

---

## 2. Architecture (run it through your head before changing anything)

Figma plugins have two execution contexts that communicate via `postMessage`:

| Context | Where | Can do | Cannot do |
|---|---|---|---|
| UI iframe | sandboxed Chrome iframe | DOM, fetch, getComputedStyle, document.fonts | call `figma.*` |
| Main thread | QuickJS sandbox inside Figma | call `figma.*` (create nodes, load fonts, etc.) | DOM, fetch, getComputedStyle |

The pipeline runs in 5 stages, crossing the boundary once:

```
[1. UI: collect input (paste, file drop, ZIP)]
        |
[2. UI: render HTML in hidden container at fixed viewport width]
        |
[3. UI: walk DOM, extract computed styles, build IRDocument]
        |
[4. postMessage UI -> main with IRDocument (pure JSON + Uint8Array bytes)]
        |
[5. Main: load fonts in batch, materialize IR into Figma nodes]
```

The IR is the contract. It is pure JSON-ish (structured clone safe), strictly typed in `src/types/ir.ts`, and the only thing that crosses the boundary. The parser produces it; the mapper consumes it. Both halves are independently testable.

ZIP support runs in stage 1: the archive is opened in the UI iframe via JSZip, the first `.html` is extracted, and relative `<img>` srcs are inlined as base64 data URLs from the archive's image assets before the HTML hits the renderer.

---

## 3. Decisions (locked, but document the reason if you ever revisit)

### D1 - Niche: Tailwind / utility-first
v1.0 is optimized for output from Tailwind / shadcn / cursor / v0. Patterns: lots of utility-class divs, predictable flex layouts, explicit design tokens. Mercato sotto-servito vs html.to.design generalist. Drives Phase 1 CSS subset, Phase 2 Auto Layout heuristics, fixture choice.

### D2 - Test infrastructure: Vitest browser mode (Playwright + Chromium)
The parser depends on `getComputedStyle`, layout calc, font metrics. jsdom doesn't compute layout, so jsdom tests would be lies. Browser mode is slower per test (~2s vs sub-second) but honest. Mapper tests run in the same browser context against a mock `figma` global (`test/mapper/_mockFigma.ts`).

### D3 - Migrated to create-figma-plugin v4 in Phase 0
Hot reload, Preact UI components, esbuild bundling, manifest generation from `package.json#figma-plugin`. Required preserving the existing plugin id `1640730172709497684` (D5).

### D4 - Image failures get a UI report, not a silent drop
CORS-blocked, network-error, not-found, format-unsupported (PNG/JPEG/GIF only): the canvas gets a grey placeholder rectangle (layout preserved), and the UI shows a card listing every failed URL with the reason. Required `networkAccess: ["*"]` in the manifest with explicit reasoning.

### D5 - Plugin id never changes
`1640730172709497684` is the Community registration key. `package.json#figma-plugin.id` is the single source of truth; `manifest.json` is gitignored and regenerated each build.

### D6 - `src/bridge/*` deferred
`emit<MyHandler>` / `on<MyHandler>` from `@create-figma-plugin/utilities` is already typed via `EventHandler` interfaces in `src/types/messages.ts`. Wrapping it adds files, not safety. Revisit if request/response correlation gets messy.

### D7 - Render harness: offscreen `<div>`, not iframe srcdoc
Tried iframe srcdoc first for full CSS isolation. Chromium has a load-event race (about:blank fires before srcdoc, `once: true` listener catches the wrong one). Container approach in `src/parser/render.ts` is robust and matches what the walker tests already use. Tradeoff: user `<style>` cascades to the plugin UI for ~100ms while the container is mounted. Acceptable. Upgrade path documented in code if real users hit pollution.

---

## 4. Feature coverage

### Supported

- Layout: `display: block/inline/inline-block`, `flex` (Auto Layout), `position: static/relative/absolute/fixed/sticky`, `z-index`, `overflow: hidden/clip` (clipsContent), padding, margin, gap (per direction), wrap, all CSS justify-content + align-items variants
- Typography: font-family (with Inter fallback via the 4-step cascade in `src/mapper/fonts.ts`), font-size, font-weight (100-900 mapped to Figma style names with italic suffix), font-style, color, line-height, letter-spacing, text-align, text-decoration (underline + line-through)
- Color/fill: background-color (with alpha), `linear-gradient` (any angle unit + `to <direction>`), `radial-gradient` (centered farthest-corner), opacity, all 15 CSS `mix-blend-mode` keywords
- Borders/effects: border-radius (4 corners independent), uniform border (single SOLID stroke, INSIDE alignment), multi/inset box-shadow
- Images: `<img>` with data URL or `https://` URL (fetch + CORS handling), magic-byte sniffing for format (PNG/JPEG/GIF only), object-fit (cover -> FILL, contain/scale-down -> FIT)
- SVG: `<svg>` inline via `figma.createNodeFromSvg` (text in SVG becomes vector paths)
- Input: paste HTML (Paste tab), drop `.html` / `.htm` file, drop `.zip` archive (auto-inlines image assets)
- UX: branded red banner header, viewport selector (320/768/1024/1440/1920 px), File/Paste tabs, persistent settings via `figma.clientStorage`, progress events every 25 nodes, styled status pill, failures card with scrollable list, GitHub footer

### Not supported (deferred)

- `transform: rotate/scale/skew` - bounding rect of a rotated element is the AABB so direct mapping misplaces it; translate works (it's in the rect)
- Pseudo-elements `::before` / `::after` - generated boxes not synthesized into IR
- Border per side (e.g. `border-bottom` only) - Figma has no per-side stroke
- Dashed / dotted border styles - all strokes render solid
- `background-image: url(...)` for raster - gradients work, URL backgrounds need parsing
- `text-shadow`, `text-transform`, `white-space`, `word-break`, `hyphens`
- Conic / diamond gradients
- Forms: `<input>`, `<textarea>`, `<select>`, `<button>`, `<form>` (skipped)
- Media: `<video>`, `<audio>`, `<canvas>`, `<iframe>` (skipped)
- Hover/focus/active states (only the resting computed style is captured)
- External `<link rel="stylesheet">` (blocked by iframe sandbox)
- Node-creation batching for >500-node docs (works but no `await` chunking; progress bar visible)

---

## 5. Phase progress

All eight phases done. The work, in commit order:

1. Phase 0 - scaffold via create-figma-plugin, IR + message types, UI<->main ping bridge, Vitest browser mode, pnpm
2. Phase 1.1 - UI input (textarea + viewport + button), stub parser, IMPORT_DOCUMENT round-trip
3. Phase 1.2 - real parser: render harness, walker, color, styles
4. Phase 1.3 - mapper: fonts batch, frame, text, orchestrator
5. Phase 1.4 - five Tailwind fixtures + smoke suite (card / navbar / hero / form / pricing-grid)
6. Phase 2 - CSS flex -> Figma Auto Layout
7. Phase 3.1 - box-shadow, uniform border, mix-blend-mode
8. Phase 3.2 - linear + radial gradients with gradientTransform math
9. Phase 4 - `<img>` (data + remote) and `<svg>` inline; manifest networkAccess widened; format sniffing fix
10. Phase 5 - overflow clipping + z-index ordering
11. Phase 6 - drop zone, progress bar, persisted settings
12. Phase 7 - README, support matrix, 5 more fixtures (button, badge, alert, mobile-navbar, footer)
13. Phase 8 - branded banner SVG, File/Paste tabs, ZIP support, polish (status pill, failures card, footer)

---

## 6. Repo layout

```
HTML-to-Figma/
+- HANDOFF.md             this file
+- README.md              user-facing
+- package.json           pnpm + figma-plugin manifest config + jszip
+- pnpm-lock.yaml
+- tsconfig.json          extends @create-figma-plugin/tsconfig, skipLibCheck on
+- vitest.config.ts       browser mode, playwright provider, chromium
+- eslint.config.js
+- assets/
|  +- community/
|  |  +- icon.png         128x128, supplied by owner
|  +- ui/                 (empty - banner SVG lives in src/ui/Banner.tsx)
+- src/
|  +- main.ts             entry: IMPORT_DOCUMENT handler, settings persistence
|  +- ui.tsx              entry: Banner + viewport + tabs + status + failures
|  +- types/
|  |  +- ir.ts            IRDocument, IRNode union, all field types
|  |  +- messages.ts      typed EventHandler interfaces for UI<->main events
|  +- parser/             runs in UI iframe
|  |  +- index.ts         parseHtmlToIR orchestrator (render -> walk -> loadImages)
|  |  +- render.ts        offscreen container at fixed viewport width
|  |  +- walker.ts        DOM -> IR recursive walk
|  |  +- styles.ts        getComputedStyle -> IR style fragments
|  |  +- color.ts         CSS color string -> IRColor via canvas normalization
|  |  +- shadow.ts        box-shadow parser
|  |  +- gradient.ts      linear/radial gradient parser
|  |  +- auto-layout.ts   CSS flex -> IRAutoLayout
|  |  +- images.ts        loadImages: data URL decode + network fetch + magic sniff
|  |  +- zip.ts           extractHtmlFromZip via JSZip + relative <img> inlining
|  +- mapper/             runs in main thread
|  |  +- index.ts         materializeIR orchestrator with progress callback
|  |  +- frame.ts         IRFrame -> FrameNode
|  |  +- text.ts          IRText -> TextNode (single-line width heuristic)
|  |  +- image.ts         IRImage -> RectangleNode + ImagePaint or grey placeholder
|  |  +- svg.ts           IRSvg -> figma.createNodeFromSvg
|  |  +- fonts.ts         resolve + batch load with 4-step Inter fallback
|  |  +- auto-layout.ts   IRAutoLayout -> Figma layoutMode + sizing + align
|  |  +- effects.ts       shadows -> Effect[], blend mode mapping
|  |  +- paint.ts         IRFill (solid + gradient) -> Figma Paint
|  +- ui/
|     +- Banner.tsx       red SVG banner via dangerouslySetInnerHTML
|     +- DropZone.tsx     dashed drop target + click-to-browse + selected file
+- test/
   +- fixtures/           10 Tailwind-style HTML files + smoke suite
   +- parser/             color, walker, styles, shadow, gradient, images, zip,
   |                       overflow-zindex, auto-layout, parse-html-to-ir
   +- mapper/             materialize, fonts, effects, paint, auto-layout, z-index
                           _mockFigma.ts (figma global stub)
```

`manifest.json` is gitignored. It is regenerated from `package.json#figma-plugin` on every `pnpm build`. Don't edit it directly.

---

## 7. Dev workflow

Prereqs: Node 20.19+ or 22.13+, pnpm 10+, Figma desktop.

```bash
pnpm install
pnpm watch              # esbuild watch with typecheck
pnpm build              # production build + minify
pnpm test               # 128 tests in headless Chromium via Vitest
pnpm test:watch
pnpm lint
pnpm lint:fix
```

In Figma desktop: Plugins -> Development -> Import plugin from manifest -> select `manifest.json` at repo root.

Reload after manifest changes: Plugins -> Development -> Manage plugins in development -> Remove -> Import again. Pure JS / TSX changes are picked up by Figma's hot reload (toggle: Plugins -> Development -> Hot reload plugin).

Plugin id `1640730172709497684` lives in `package.json#figma-plugin.id`. Do not change it - that's the Community registration key.

---

## 8. Style conventions (sticky)

- No em-dashes anywhere. Stripped from the entire repo on 2026-05-25 because they read 'AI wrote this'. Use plain hyphens or rewrite the sentence.
- No `any`. The IR is strictly typed; if you need a generic, add a constrained one.
- Tests live next to what they exercise: `src/parser/walker.ts` -> `test/parser/walker.test.ts`.
- Mock Figma lives in `test/mapper/_mockFigma.ts`. Extend it when adding new mapper code paths.

---

## 9. Open items (the only things left)

### For Figma Community submission

| Item | Where | Status |
|---|---|---|
| Plugin icon 128x128 PNG | `assets/community/icon.png` | Provided by owner |
| Cover image 1920x960 PNG | needs designer | Not provided |
| 4-8 screenshots, ~1920px wide | needs recording | Not provided |
| Demo GIF, optional, =30s | needs recording | Not provided |
| Security disclosure form | filled at publish time | Not started |
| Listing copy (title, tagline, description, tags) | not drafted | Not started |

Submission flow once assets exist: Figma desktop -> Plugins -> Development -> Manage plugins in development -> Publish to Community -> walk the form, upload assets, paste `networkAccess.reasoning` from `package.json` into the network access justification field. Review takes ~5-10 business days.

### For real-world hardening before launch

Test on actual HTML from the owner's projects (cursor/v0/shadcn output, marketing pages, design system components). Every edge case found becomes a fixture in `test/fixtures/` + a fix.

### Known issues / improvements parked for v1.1+

- Transform rotate/scale (AABB-vs-rotated-rect math)
- Pseudo-elements `::before` / `::after`
- Per-side borders (synthetic thin frames as workaround)
- `background-image: url(...)` for raster URLs
- `text-shadow`, `text-transform`, white-space handling
- Node-creation batching with `await Promise.resolve()` chunking for >500-node docs
- Listing tabs for ZIP separately (currently one File tab accepts both .html and .zip)

---

## 10. How to resume

1. `cd C:\Users\avrea\Desktop\Lavoro\Progetti\HTML-to-Figma`
2. `git pull`
3. `pnpm install`
4. Read this file top to bottom
5. `pnpm test` to confirm 128/128 still pass
6. Decide a goal:
   - Add a feature from the deferred list above
   - Address feedback from a real-world test
   - Draft Community submission copy
   - Iterate on the banner / cover / screenshots
7. Open a chat with this file's contents pasted in (or referenced) and say what you want to do.
