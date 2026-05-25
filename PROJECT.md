# HTML to Figma — Plugin Figma

> Documento di contesto principale per Claude Code. Leggere prima di qualsiasi modifica al codice.

---

## 1. Cosa stiamo costruendo

Un **plugin Figma gratuito e client-side** che converte HTML+CSS in nodi Figma nativi (Frame, Text, Rectangle, ecc.) preservando layout, tipografia, colori, immagini e — dove possibile — mappando flexbox a Auto Layout.

**Obiettivo v1.0**: pubblicare sulla Figma Community un plugin che funzioni in modo affidabile su un sottoinsieme ben definito di input HTML, con limitazioni chiaramente documentate.

**Non-obiettivo**: battere html.to.design sul caso generale. Vogliamo essere migliori su una nicchia specifica (da definire) e onestamente buoni sul resto.

---

## 2. Vincoli architetturali fondamentali

Il plugin Figma ha **due ambienti di esecuzione separati** che comunicano via `postMessage`:

### Main thread (`code.ts` / `main.ts`)
- Sandbox QuickJS dentro Figma
- **Accesso**: API Figma (`figma.createFrame()`, `figma.loadFontAsync()`, ecc.)
- **NIENTE**: DOM, `fetch`, `getComputedStyle`, `window`, `document`
- Qui si **scrivono** i nodi Figma

### UI iframe (`ui.html` / `ui.tsx`)
- Iframe Chrome normale
- **Accesso**: DOM completo, `fetch`, `DOMParser`, `getComputedStyle`, `document.fonts`
- **NIENTE**: API Figma
- Qui si **parsa** l'HTML e si **estraggono** gli stili

### Implicazione
Tutto il parsing HTML, rendering nascosto e estrazione stili **deve** avvenire nell'iframe UI. Il main thread riceve solo una rappresentazione intermedia (IR) serializzabile in JSON e si occupa di materializzarla in nodi Figma.

**Non tentare mai** di parsare HTML nel main thread o di chiamare API Figma dall'iframe — non funziona, non c'è workaround.

---

## 3. Architettura: pipeline a 5 stadi

```
[1. Input UI]
    ↓ (HTML string + opzioni)
[2. Rendering nascosto nell'iframe]
    ↓ (DOM tree vivo + font caricati)
[3. Walker + estrazione computed styles]
    ↓ (IR: Intermediate Representation JSON)
[4. postMessage UI → main]
    ↓ (IR serializzato)
[5. Materializzazione in nodi Figma]
    ↓
[Canvas Figma popolato]
```

Stadi 1-4 nell'iframe UI. Stadio 5 nel main thread.

### Perché l'IR è importante

L'IR è il **contratto** tra parser (UI) e mapper (main). Mantenerlo:
- Puro JSON serializzabile (no funzioni, no riferimenti DOM, no `Uint8Array` annidati senza encoding)
- Tipizzato in TypeScript con tipi condivisi
- Testabile in isolamento (il parser produce IR, il mapper consuma IR — entrambi unit-testabili)

Le immagini nell'IR vanno passate come `Uint8Array` (Figma accetta), che `postMessage` clona via structured clone correttamente.

---

## 4. Stack tecnico

- **TypeScript** (strict mode)
- **`create-figma-plugin`** di Yuan Qing Lim come scaffolding e build system (sostituisce lo scaffold default di Figma quando passiamo al setup serio)
- **Preact** per la UI iframe (più leggero di React, ok per iframe piccolo)
- **`@figma/plugin-typings`** per i tipi dell'API Figma
- **Vitest** per unit test (specialmente parser e mapper in isolamento)
- **esbuild** come bundler (gestito da create-figma-plugin)

Niente librerie HTML parser esterne nel parser: usiamo `DOMParser` nativo dell'iframe, è migliore di qualsiasi parser JS.

---

## 5. Piano di sviluppo per fasi

Procedere **una fase alla volta**, non saltare avanti. Ogni fase deve essere funzionante e testata prima di passare alla successiva.

### Fase 0 — Setup (in corso)
- [x] Scaffolding base via Figma desktop
- [ ] Migrare a `create-figma-plugin` mantenendo lo stesso plugin `id` nel manifest
- [ ] Setup bridge RPC tipizzato UI ↔ main
- [ ] Hot reload funzionante
- [ ] Vitest configurato
- [ ] Tipi condivisi in `src/types/ir.ts`

### Fase 1 — MVP "rettangoli e testo"
Obiettivo: incollo un HTML semplice (div con testo, colori, padding) e ottengo qualcosa di riconoscibile in Figma.
- [ ] UI: textarea per incollare HTML, bottone "Import"
- [ ] Rendering nascosto dell'HTML in `<div>` invisibile dell'iframe
- [ ] Walker DOM ricorsivo
- [ ] Estrazione subset minimo di computed styles (~15 proprietà: width, height, x, y derivate, background-color, color, font-family, font-size, font-weight, padding, margin, display)
- [ ] Costruzione IR
- [ ] Mapper main thread: div → Frame, span/p/h1-6 → TextNode
- [ ] Font loading con `figma.loadFontAsync`, fallback su Inter se font non disponibile
- [ ] Layout assoluto (no Auto Layout ancora)
- [ ] Test su 5 HTML campione

### Fase 2 — Auto Layout intelligente
- [ ] Detect `display: flex` → Auto Layout (direction, gap, padding, primaryAxisAlign, counterAxisAlign)
- [ ] Mapping `justify-content` / `align-items` → assi Auto Layout
- [ ] Euristica per `display: block` con figli ben spaziati → Auto Layout verticale (opzionale, toggle)
- [ ] `display: grid` → fallback a posizioni assolute (Figma non ha grid nativo)
- [ ] `flex-wrap` → Auto Layout con wrap

### Fase 3 — Stile completo
- [ ] Gradients (`linear-gradient`, `radial-gradient`) → `GradientPaint`
- [ ] `border-radius` (incluse le 4 corner indipendenti)
- [ ] `box-shadow` (anche multipli, anche inset) → `DropShadowEffect` / `InnerShadowEffect`
- [ ] `border` uniform → stroke
- [ ] `border` per-side → workaround (in Figma non esistono nativamente)
- [ ] `opacity`, `mix-blend-mode`
- [ ] `text-decoration`, `letter-spacing`, `line-height`, `text-align`

### Fase 4 — Immagini e media
- [ ] `<img>` con `src` data URL → `figma.createImage` + `ImagePaint`
- [ ] `<img>` con URL assoluto → fetch nell'iframe + check CORS, documentare limitazione
- [ ] `background-image: url(...)` → idem
- [ ] `object-fit: cover/contain` → `imageTransform` o scaleMode
- [ ] SVG inline → `figma.createNodeFromSvg()`

### Fase 5 — Edge cases e robustezza
- [ ] HTML malformato → DOMParser gestisce, verificare
- [ ] `<style>` inline ✓ (già coperto da getComputedStyle)
- [ ] `<link>` esterni → bloccati da CORS, documentare
- [ ] `position: absolute/fixed/sticky`
- [ ] `transform: translate/rotate/scale` → `relativeTransform`
- [ ] Pseudo-elementi `::before/::after` → `getComputedStyle(el, '::before')` + nodi sintetici
- [ ] `display: none` → skip
- [ ] `visibility: hidden` → skip o nodo invisibile
- [ ] `overflow: hidden` → clip frame
- [ ] `z-index` → reorder nodi
- [ ] Nesting profondo (>50) → safe-guard
- [ ] Documenti grandi (>500 nodi) → batch creation + progress bar

### Fase 6 — UI e UX
- [ ] Drop zone per file `.html`
- [ ] Drop zone per zip (HTML + assets)
- [ ] Tab "Paste" / "File" / "ZIP"
- [ ] Settings: viewport width (default 1440), unità fallback
- [ ] Progress bar durante import
- [ ] Error toast con messaggi chiari
- [ ] Link a docs per features non supportate

### Fase 7 — Polish per Community review
- [ ] Cover image 1920x960 (richiesta da Figma)
- [ ] Screenshot / GIF demo
- [ ] Descrizione plugin
- [ ] README pubblico con matrice "supportato / non supportato"
- [ ] Repo GitHub pubblico (canale supporto = Issues)
- [ ] Security disclosure form compilato
- [ ] Naming check (no conflitti, no "Figma" nel nome)
- [ ] Testing batteria di 30+ HTML reali

---

## 6. Struttura cartelle target

Dopo la migrazione a `create-figma-plugin`:

```
HTML-to-Figma/
├── PROJECT.md              ← questo file
├── DECISIONS.md            ← log decisioni architetturali (creare alla bisogna)
├── SUPPORT_MATRIX.md       ← cosa è supportato e cosa no (mantenere aggiornato)
├── manifest.json           ← config plugin (id NON modificare)
├── package.json
├── tsconfig.json
├── src/
│   ├── main.ts             ← entry point main thread
│   ├── ui.tsx              ← entry point UI iframe
│   ├── types/
│   │   ├── ir.ts           ← tipi IR condivisi
│   │   └── messages.ts     ← tipi messaggi UI↔main
│   ├── parser/             ← gira nell'iframe UI
│   │   ├── render.ts       ← rendering nascosto HTML
│   │   ├── walker.ts       ← walk DOM ricorsivo
│   │   ├── styles.ts       ← estrazione computed styles
│   │   ├── images.ts       ← fetch e conversione immagini
│   │   └── index.ts        ← orchestrazione → IR
│   ├── mapper/             ← gira nel main thread
│   │   ├── frame.ts        ← creazione FrameNode
│   │   ├── text.ts         ← creazione TextNode
│   │   ├── image.ts        ← creazione ImagePaint
│   │   ├── effects.ts      ← shadows, blur
│   │   ├── auto-layout.ts  ← logica Auto Layout
│   │   ├── fonts.ts        ← gestione font loading
│   │   └── index.ts        ← orchestrazione IR → Figma
│   ├── bridge/
│   │   ├── main.ts         ← RPC lato main
│   │   └── ui.ts           ← RPC lato UI
│   └── ui/
│       ├── App.tsx
│       └── components/
└── test/
    ├── parser/             ← unit test parser
    ├── mapper/             ← unit test mapper (con mock Figma API)
    └── fixtures/           ← HTML campione per regression
```

---

## 7. Linee guida per Claude Code

### Cosa fare sempre

1. **Aggiornare `SUPPORT_MATRIX.md`** quando aggiungi/rimuovi supporto a una feature CSS.
2. **Aggiornare `DECISIONS.md`** quando prendi una decisione architetturale non ovvia (es. "perché non supportiamo grid", "perché fallback a Inter").
3. **Scrivere unit test** per ogni funzione nel parser e nel mapper. L'IR è puro JSON, è banale testarlo.
4. **Tipizzare strettamente l'IR** — niente `any`, niente union types vaghi.
5. **Aggiungere fixture HTML** in `test/fixtures/` per ogni caso nuovo gestito (regression suite).
6. **Documentare nel codice** ogni decisione "strana" — es. perché abbiamo gestito un edge case in un certo modo.

### Cosa non fare mai

1. **Non chiamare API Figma dall'iframe UI** o DOM dal main thread. Sempre via bridge.
2. **Non aggiungere dipendenze pesanti** alla UI iframe (resta sotto i 200KB di bundle iframe).
3. **Non implementare features fuori dalla fase corrente** senza prima discutere — è facile esplodere di scope.
4. **Non assumere che un computed style sia in unità "umane"**: `getComputedStyle` restituisce sempre valori risolti in px (per dimensioni) e rgb/rgba (per colori). Niente rem, niente named colors a runtime.
5. **Non fare chiamate di rete dal main thread** — non può.
6. **Non modificare il `manifest.json` `id`** — è il legame con la registrazione Figma.

### Workflow per ogni task

1. Leggere la fase corrente nel piano sopra
2. Identificare il sub-task specifico
3. Proporre modifiche file per file, una unit logica alla volta
4. Includere test
5. Aggiornare i .md di documentazione se rilevante
6. Stop. Aspettare review prima di passare al prossimo sub-task.

---

## 8. Note sulle API Figma chiave

Cose che è utile sapere subito e che spesso confondono:

- `figma.loadFontAsync({family, style})` va chiamato **prima** di creare/modificare ogni TextNode con quel font. Caricare in batch unico in cima al mapper, non on-demand.
- I `FrameNode` con Auto Layout hanno `layoutMode = "HORIZONTAL" | "VERTICAL" | "NONE"`. Le proprietà di sizing sono separate dal layout mode: `primaryAxisSizingMode`, `counterAxisSizingMode` (`"AUTO"` = hug, `"FIXED"` = fixed).
- Per riempire un nodo con un colore: `node.fills = [{type: "SOLID", color: {r, g, b}, opacity}]`. R/G/B sono **0-1**, non 0-255.
- Per immagini: prima `const img = figma.createImage(uint8Array)`, poi `node.fills = [{type: "IMAGE", imageHash: img.hash, scaleMode: "FILL"}]`.
- Per SVG: `figma.createNodeFromSvg(svgString)` ritorna un `FrameNode` con l'SVG dentro. È la via più semplice per SVG inline.
- Coordinate: Figma usa `x`, `y` con origine in alto a sinistra, come il web. `relativeTransform` permette rotazioni.
- `node.appendChild(child)` per nestare. L'ordine di append determina lo z-order (ultimo = in cima).

---

## 9. Dev workflow

```bash
# Watch mode (ricompila a ogni save)
npm run watch

# Build di release
npm run build

# Test
npm run test

# In Figma desktop: Cmd/Ctrl + Alt + P per ri-aprire ultimo plugin
# Hot reload: Plugins → Development → Hot reload plugin (attivare)
# Console main thread: Plugins → Development → Open Console
# Console iframe UI: tasto destro sull'iframe → Inspect
```

---

## 10. Cosa è ancora aperto / da decidere

- **Nicchia di posizionamento** (Tailwind-aware? shadcn? email HTML? generico?) — decidere prima di Fase 2 perché impatta le euristiche di Auto Layout.
- Se aggiungere supporto a zip upload (con assets) in Fase 4 o rimandare.
- Se aggiungere analytics opt-in dopo v1.0.
- Licenza del repo (probabilmente MIT, da confermare).

---

## 11. Riferimenti

- [Figma Plugin API docs](https://www.figma.com/plugin-docs/)
- [create-figma-plugin](https://yuanqing.github.io/create-figma-plugin/)
- [Figma Plugin Review Guidelines](https://help.figma.com/hc/en-us/articles/360039958914)
- [Publishing to Community](https://help.figma.com/hc/en-us/articles/360042293394)

---

**Owner**: Edoardo / Redergo
**Stato**: Fase 0 in corso
**Ultima revisione**: 2026-05-25
