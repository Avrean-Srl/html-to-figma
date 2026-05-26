import { rewriteModernCssColors } from './css-color-shim'

export interface RenderHandle {
  body: HTMLElement
  doc: Document
  cleanup: () => void
}

// Renders the HTML in a hidden same-origin iframe sized to viewportWidth.
//
// Why an iframe and not an offscreen <div>:
//   - @media queries inside the imported CSS are evaluated against the
//     iframe's viewport, not the plugin UI window. A page that switches
//     to a desktop layout at min-width: 1024px now actually does so.
//   - CSS rules in the imported document are scoped to the iframe and
//     cannot leak into the plugin UI (no more `body { background: white }`
//     flashing the plugin chrome).
//
// The historical D7 race ("about:blank load fires before srcdoc load")
// is avoided by setting srcdoc BEFORE appending the iframe to the DOM:
// the iframe is born with srcdoc as its source, so the transient
// about:blank navigation never happens. We still defend against any
// stragglers by waiting until the document is parsed (readyState !==
// 'loading') AND has body content before returning.
//
// `iframe.contentDocument.fonts.ready` waits for Geist / Inter / any
// @font-face declarations referenced by the page; we ignore the wait
// failure path so older sandboxes still parse, layout just becomes
// best-effort for fonts.
export async function renderHidden(
  html: string,
  viewportWidth: number
): Promise<RenderHandle> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('title', 'HTML to Figma render harness')
  // Iframe height MUST resemble a typical viewport, not "tall enough to
  // contain the whole page". 100vh inside the iframe resolves to
  // iframe.height, so a 24000-px iframe makes every `min-height: 100vh`
  // section balloon to 24000 - the page's body fills the iframe and
  // body.scrollHeight feeds back the inflated value. A real viewport
  // height (1080 for desktop) keeps 100vh sane; content taller than the
  // viewport still measures correctly because getBoundingClientRect and
  // scrollHeight work for off-viewport content.
  const sandboxHeight = viewportHeightFor(viewportWidth)
  iframe.style.cssText = [
    'position: fixed',
    'left: -99999px',
    'top: 0',
    `width: ${viewportWidth}px`,
    `height: ${sandboxHeight}px`,
    'border: 0',
    'margin: 0',
    'padding: 0',
    'visibility: visible'
  ].join('; ')

  // Attach the load listener BEFORE setting srcdoc so we capture the
  // very first load event for the srcdoc document. Setting srcdoc
  // before append means there is no intermediate about:blank.
  const loaded = new Promise<void>((resolve) => {
    iframe.addEventListener('load', () => resolve(), { once: true })
  })

  // Defensively rewrite oklch()/oklab() to rgba() before injection.
  // Figma desktop's embedded Chromium may lag the browser's CSS Color
  // Level 4 support, and an unrecognized color function makes the
  // browser drop the rule entirely - which is exactly how the boero
  // mockup ended up with no body background.
  iframe.srcdoc = wrapForHarness(rewriteModernCssColors(html))
  document.body.appendChild(iframe)

  await loaded

  const doc = iframe.contentDocument
  if (doc === null || doc.body === null) {
    iframe.remove()
    throw new Error('iframe document failed to initialize')
  }

  // Belt-and-braces: if the load event fired for an empty document
  // (some browser edge case), give the parser one more turn.
  if (doc.body.children.length === 0 && doc.readyState !== 'complete') {
    await new Promise<void>((resolve) => {
      const onReady = () => {
        if (doc.readyState === 'complete') {
          doc.removeEventListener('readystatechange', onReady)
          resolve()
        }
      }
      doc.addEventListener('readystatechange', onReady)
    })
  }

  // Force a synchronous layout pass before any measurements.
  void doc.body.offsetHeight

  // Deliberately do NOT resize the iframe to fit content. Doing so would
  // change the computed value of 100vh and trigger a feedback loop on
  // any page that uses `min-height: 100vh` or `height: 50vh` etc.
  // getBoundingClientRect / scrollHeight work for off-viewport content,
  // so the walker can still measure the full page from a short iframe.

  // Promote every element that looks like a JS-driven scroll-reveal
  // (sitting at opacity 0 / a translate transform waiting for an
  // IntersectionObserver to add an "is-visible" class) to its final
  // state. We strip <script> blocks before render so the JS half of
  // that pattern never fires - without this pass, every .reveal,
  // [data-aos], [data-scroll] element would import invisible.
  forceRevealedState(doc)

  try {
    await doc.fonts.ready
  } catch {
    // Older browsers or restricted contexts may not expose
    // document.fonts. Font matching becomes best-effort; layout
    // still works.
  }

  return {
    body: doc.body,
    doc,
    cleanup: () => iframe.remove()
  }
}

// Forces elements that look like scroll-reveal / on-load animation
// targets to their resting/final state. We detect by the pairing
// pattern - `opacity < 1` AND `transition-property` mentions opacity,
// or a non-identity `transform` AND `transition-property` mentions
// transform / `all`. That matches `.reveal { opacity: 0; transform:
// translateY(...); transition: opacity ..., transform ... }` and
// data-attribute-driven libraries (AOS, ScrollReveal, GSAP-with-CSS-
// fallback) without sweeping up intentionally dim UI like hovered
// chips or disabled buttons (those don't transition opacity).
//
// The override is applied as INLINE style so it wins the cascade no
// matter what `!important` exists elsewhere. We don't restore on
// cleanup because the iframe is thrown away after walking.
function forceRevealedState(doc: Document): void {
  const win = doc.defaultView ?? window
  const all = doc.body.querySelectorAll('*')

  // Pass 1 - detect. We have to do this BEFORE neutralising
  // transitions, because the transition-duration property is the
  // signal that distinguishes a deliberate `.reveal { transition:
  // opacity ... }` from the browser default of transition-property:
  // all + duration 0s on every element.
  const toForce: Array<{
    el: HTMLElement
    opacity: boolean
    transform: boolean
  }> = []
  for (let i = 0; i < all.length; i++) {
    const el = all[i] as HTMLElement
    const cs = win.getComputedStyle(el)
    const durations = cs.transitionDuration
      .split(',')
      .map((s) => parseTimeToMs(s.trim()))
    const hasNonZeroDuration = durations.some((ms) => ms > 0)
    if (!hasNonZeroDuration) continue

    const transitionProp = cs.transitionProperty
    const mentionsOpacity =
      transitionProp.includes('opacity') || transitionProp === 'all'
    const mentionsTransform =
      transitionProp.includes('transform') || transitionProp === 'all'

    const opacityNum = parseFloat(cs.opacity)
    const opacityShifted =
      Number.isFinite(opacityNum) && opacityNum < 1 && mentionsOpacity

    const transformVal = cs.transform
    const transformShifted =
      transformVal &&
      transformVal !== 'none' &&
      transformVal !== 'matrix(1, 0, 0, 1, 0, 0)' &&
      mentionsTransform

    if (opacityShifted || transformShifted) {
      toForce.push({
        el,
        opacity: opacityShifted,
        transform: Boolean(transformShifted)
      })
    }
  }
  if (toForce.length === 0) return

  // Pass 2 - kill transitions globally before we mutate any property,
  // otherwise setting `opacity: 1` triggers an 800 ms fade and the
  // walker reads the in-flight value (close to 0) when it measures
  // a beat later. Doing this AFTER detection preserves the duration
  // cue we needed in pass 1.
  const killStyle = doc.createElement('style')
  killStyle.setAttribute('data-h2f-harness-transitions-off', 'true')
  killStyle.textContent =
    '*, *::before, *::after { transition-duration: 0s !important; transition-delay: 0s !important; }'
  ;(doc.head ?? doc.documentElement).appendChild(killStyle)

  // Pass 3 - flip detected elements to their final state inline.
  for (const { el, opacity, transform } of toForce) {
    if (opacity) el.style.setProperty('opacity', '1', 'important')
    if (transform) el.style.setProperty('transform', 'none', 'important')
  }
}

function parseTimeToMs(t: string): number {
  if (t.endsWith('ms')) return parseFloat(t)
  if (t.endsWith('s')) return parseFloat(t) * 1000
  return 0
}

// Picks a sensible "100vh" reference for the harness. Aspect ratio is
// roughly 16:10 for desktop widths and 16:9 for mobile, matching the
// most common physical viewports a designer would pick. Clamped to
// [600, 1200] so a 1920-wide import doesn't make 100vh dwarf realistic
// content.
function viewportHeightFor(viewportWidth: number): number {
  if (viewportWidth <= 480) return 720
  if (viewportWidth <= 800) return 1024
  if (viewportWidth <= 1200) return 800
  if (viewportWidth <= 1440) return 900
  return 1080
}

// Injects a small CSS preamble at the top of the harness HTML so:
//   - the iframe never grows a vertical scrollbar (which otherwise
//     eats ~17 px from the right of the body, leaving a visible empty
//     gutter in every imported frame);
//   - CSS animations and transitions don't run, so the snapshot
//     captures resting/final styles instead of whatever frame an
//     entry animation happened to be on when document.fonts.ready
//     resolved. We can't wait for "all animations finished" because
//     many real sites use infinite pulses or scroll-driven animations
//     that would never settle.
//
// The preamble lives in a `<style>` block tagged data-h2f-harness so it
// is easy to spot if it ever leaks into a UI screenshot, and the rules
// use `!important` so a page-level reset can't override them.
// We deliberately do NOT zero transition-duration. Without JavaScript
// running, transitions never fire (they require a state change to
// trigger), so leaving them at their author-declared value is visually
// equivalent - and it preserves transition-property + transition-
// duration as authentic cues for detecting scroll-reveal patterns in
// forceRevealedState(). Animations are different: they auto-play, so
// we still zero their duration so they snap to fill-mode: forwards.
const HARNESS_PREAMBLE = `<style data-h2f-harness="true">
  html, body { overflow: hidden !important; scrollbar-width: none !important; }
  html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-play-state: paused !important;
    caret-color: transparent !important;
  }
</style>`

function wrapForHarness(html: string): string {
  // Prefer injecting right after <head> so the preamble lands before
  // any author stylesheet (and therefore loses the cascade race - we
  // intentionally use !important to win it back). If no <head> exists,
  // prepend at the top of the document; the browser still parses it
  // as if it were head content.
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/(<head\b[^>]*>)/i, `$1${HARNESS_PREAMBLE}`)
  }
  return `${HARNESS_PREAMBLE}${html}`
}
