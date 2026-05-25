# DECISIONS

> Log delle decisioni architetturali e di scope. Append-only. Ogni voce: cosa, perché, alternative scartate, data, impatto.

---

## D1 — Nicchia di posizionamento v1.0: Tailwind / utility-first

**Data**: 2026-05-25
**Status**: Locked per v1.0
**Impatto**: Fase 1 (subset CSS), Fase 2 (euristiche Auto Layout), test fixtures, copy del plugin sulla Community.

### Decisione
Il plugin è ottimizzato per HTML generato da framework utility-first: Tailwind CSS, shadcn/ui, e simili. Il caso d'uso target è lo sviluppatore che prototipa in codice e porta la UI in Figma per design review, hand-off, o per ricostruire il design system in Figma a partire dall'implementazione.

### Perché
- Mercato sotto-servito: html.to.design è generalista; nessuno è ottimizzato per il pattern Tailwind (molti `<div>` con classi atomiche, layout flexbox prevedibili, design tokens espliciti).
- DOM tipico è ad alta entropia ma a bassa varianza strutturale → euristiche Auto Layout più affidabili.
- Allineato al profilo utente reale (dev che usano cursor/v0/shadcn) — più probabile che installino plugin dalla Community se risolve il loro caso specifico.

### Alternative scartate
- **Landing/marketing pages (Webflow/Framer export)**: già coperto bene da plugin esistenti; mercato saturo.
- **Email HTML**: nicchia interessante ma stretta; table-based layouts richiedono pipeline diversa (no flex, no grid) → quasi un secondo plugin.
- **Generico no-nicchia**: indistinguibile da html.to.design senza vantaggio competitivo.

### Conseguenze concrete
- Le fixture di Fase 1 includono almeno: card shadcn, form con label/input, grid di card Tailwind, navbar utility, dialog.
- Le euristiche Auto Layout di Fase 2 priorizzano pattern flex comuni in Tailwind (`flex items-center gap-X`, `flex-col space-y-X`, ecc.).
- `display: block` con figli ben spaziati → Auto Layout verticale è ON di default (override-able da settings).
- Il README / Community description menziona esplicitamente Tailwind + shadcn come use case primario.

---

## D2 — Test infrastructure: Vitest browser mode (Playwright)

**Data**: 2026-05-25
**Status**: Locked per Fase 0
**Impatto**: setup Fase 0, costo CI, velocità iterazione test.

### Decisione
Vitest in browser mode con provider Playwright (headless). Il parser DOM è testato end-to-end in un vero Chromium, non in jsdom. Il mapper resta testabile con Vitest standard (Node) usando mock minimale dell'API Figma.

### Perché
Il parser dipende criticamente da `getComputedStyle`, layout calcolato, e font metrics. jsdom non calcola layout — tutti i test del parser sarebbero falsi positivi o forzati a mockare ciò che vogliamo testare.

### Alternative scartate
- **Solo jsdom + unit test funzioni pure**: copertura del parser di fatto zero. Bug di layout scoperti solo manualmente in Figma → ciclo di feedback lento.
- **Inizio jsdom, upgrade quando serve**: refactor del setup test dopo che la suite è cresciuta → costo ritardato ma maggiore.

### Conseguenze concrete
- `vitest.config.ts` con `test.browser.provider = 'playwright'`, `headless: true`.
- Test del parser in `test/parser/` girano in Chromium.
- Test del mapper in `test/mapper/` girano in Node con mock di `figma.*`.
- CI installa Playwright browsers (~150MB), accettabile.
- Hot test loop più lento di jsdom (~2-3s vs sub-secondo) ma onesto.

---

## D3 — Migrazione a create-figma-plugin: subito in Fase 0

**Data**: 2026-05-25
**Status**: In esecuzione (Fase 0)
**Impatto**: package.json, manifest.json, struttura file, build pipeline.

### Decisione
Migrare immediatamente dallo scaffold default Figma (`code.ts` + `ui.html`) a `create-figma-plugin` di Yuan Qing Lim. Avviene prima di scrivere qualsiasi codice di parser/mapper.

### Perché
- Hot reload integrato, bundle UI con Preact pronto, struttura src/ standardizzata.
- Bridge UI ↔ main tipizzato con `emit`/`on` di create-figma-plugin → meno boilerplate, meno bug.
- Migrare dopo MVP significa rifare il setup del bridge e dei tipi quando il codice è già fluido → costo doppio.

### Vincolo critico
`manifest.json` deve preservare `id: "1640730172709497684"`. `create-figma-plugin` genera il manifest da `package.json`; va configurato esplicitamente per non sovrascrivere l'id.

### Alternative scartate
- **Dopo MVP**: refactor del bridge e dei tipi messaggi al cambio → lavoro doppio.
- **Resto su scaffold Figma**: niente hot reload affidabile, bundling manuale di Preact, più boilerplate. Senso solo se vogliamo controllo totale del build — non è il caso.

---

## D4 — Strategia immagini con CORS bloccato: UI esplicita con lista fallimenti

**Data**: 2026-05-25
**Status**: Locked per Fase 4
**Impatto**: Fase 4 (immagini), `networkAccess` nel manifest, UX import flow.

### Decisione
Quando un'immagine remota fallisce per CORS o errore di rete: creo un placeholder rettangolo grigio nel posto giusto (con dimensioni e proprietà preservate) e raccolgo l'URL fallito in una lista. A fine import, mostro un report nella UI: "N immagini non caricate" con elenco URL e motivo, e link/bottone per scaricarle manualmente e re-importarle.

### Perché
- Per un plugin Community, la maggior parte dell'HTML "reale" che gli utenti incollano contiene `<img>` remoti. Skip silenzioso → l'utente vede design rotto e non sa perché.
- UI esplicita educa l'utente sui limiti tecnici del browser (CORS) senza farlo sembrare un bug del plugin.
- Placeholder nelle posizioni corrette = layout preservato anche con immagini mancanti → review designer comunque utile.

### Alternative scartate
- **Skip silenzioso con console log**: utente non vede il problema → percepito come bug, abbandono.
- **Best effort con fallback proxy automatico**: nessun proxy gratis e affidabile per CORS; gestire proxy interno significa hosting + costi → fuori scope v1.0.

### Conseguenze concrete
- `manifest.json` → `networkAccess.allowedDomains: ["*"]` (necessario per `fetch` da iframe verso domini arbitrari). Documentare nel security disclosure form di Fase 7.
- Tipo IR per `image` ha campo `loadStatus: 'ok' | 'cors-blocked' | 'network-error' | 'not-found'` per propagare il fallimento al mapper.
- UI Fase 4 ha pannello post-import con lista URL falliti, copy-friendly, e CTA "Scarica manualmente e re-incolla l'HTML con data URL".

---

## D5 — Plugin id preservation policy

**Data**: 2026-05-25
**Status**: Locked permanently

### Decisione
Il plugin id `1640730172709497684` nel `manifest.json` non si tocca, mai. È la chiave di registrazione presso Figma e cambiarlo significa pubblicare un plugin diverso (perdere review, installazioni, identità Community).

Con `create-figma-plugin`, il `manifest.json` è generato dal campo `figma-plugin.id` in `package.json`. Quello è ora l'unica fonte di verità — il `manifest.json` è gitignorato perché rigenerato a ogni build.

### Conseguenze
- Qualsiasi script di build (incluso create-figma-plugin) che rigenera `manifest.json` deve essere configurato per preservare l'id via `package.json`.
- Test di Fase 0 finale: build da zero, verificare che `manifest.json` generato contenga ancora `1640730172709497684`. **Eseguito 2026-05-25, OK.**
- Se mai dovessimo riscrivere il plugin da zero, l'id resta — è l'identità pubblica del plugin.

---

## D6 — Niente cartella `src/bridge/*` per ora, emit/on diretti

**Data**: 2026-05-25
**Status**: Aperto, rivedibile in Fase 1

### Decisione
PROJECT.md §6 prevede `src/bridge/main.ts` e `src/bridge/ui.ts`. Per Fase 0 non li creiamo: usiamo direttamente `emit`/`on` da `@create-figma-plugin/utilities` con generics tipizzati tramite gli `EventHandler` definiti in `src/types/messages.ts`.

### Perché
- `emit<MyHandler>('EVENT', payload)` è già tipizzato. Un wrapper aggiungerebbe file senza aggiungere safety o ergonomia.
- I file `bridge/*` avrebbero senso quando volessimo:
  - Logica RPC request/response (correlare risposta a chiamata)
  - Logging/instrumentazione centralizzata
  - Mock del bridge per test del mapper

Nessuno di questi serve in Fase 0. Premature abstraction.

### Quando rivedere
A Fase 1, quando arriverà il flusso `IMPORT_DOCUMENT` (UI→main) con risposta `IMPORT_COMPLETE`/`IMPORT_ERROR`. Se la correlazione richiesta/risposta diventa scomoda inline, estrarre in `src/bridge/`. Aggiornare questa decisione quando succede.

### Conseguenze
- `src/types/messages.ts` è l'unica fonte dei contratti UI↔main.
- Aggiornare PROJECT.md §6 con nota "bridge/ TBD, non bloccante per Fase 0/1".
