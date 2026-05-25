# HTML to Figma

Figma plugin that converts HTML+CSS into native Figma nodes (Frame, Text, Rectangle, Auto Layout), preserving layout, typography, colors, and images.

**Status**: Phase 0 (setup). Not yet published to Figma Community.
**Niche**: Tailwind / utility-first HTML. See [DECISIONS.md](DECISIONS.md) D1.

For full project context, architecture, and the phased roadmap, read [PROJECT.md](PROJECT.md). For locked-in decisions and their rationale, see [DECISIONS.md](DECISIONS.md).

## Stack

- TypeScript (strict)
- [create-figma-plugin](https://yuanqing.github.io/create-figma-plugin/) v4 with Preact UI
- Vitest in browser mode (Playwright + Chromium) for parser tests that need real `getComputedStyle`
- pnpm for dependency management

## Dev workflow

Prerequisites: Node 20.19+ or 22.13+, pnpm 10+, Figma desktop app.

```bash
pnpm install            # one-time setup
pnpm watch              # rebuild on save while you develop
pnpm build              # production build (typecheck + minify)
pnpm test               # run the test suite once
pnpm test:watch         # vitest watch mode
```

After `pnpm build` (or with `pnpm watch` running), the generated `manifest.json` lives at the repo root. In Figma desktop:

1. Plugins → Development → **Import plugin from manifest** → select `manifest.json`
2. Run it from the Plugins menu, or reopen with **Ctrl/Cmd+Alt+P**
3. Toggle **Plugins → Development → Hot reload plugin** to pick up file saves automatically

## Repo layout

```
src/
  main.ts            # entry — runs in Figma sandbox, has figma.* API
  ui.tsx             # entry — runs in iframe, has DOM + fetch
  types/
    ir.ts            # Intermediate Representation (parser → mapper contract)
    messages.ts      # typed UI ↔ main events
test/
  parser/            # parser tests (run in real Chromium via Vitest browser mode)
```

Plugin manifest fields (id, name, networkAccess, etc.) live in `package.json` → `figma-plugin`. The `manifest.json` file is regenerated on every build and is gitignored.

## License

MIT.
