export interface RenderHandle {
  body: HTMLElement
  doc: Document
  cleanup: () => void
}

// Phase 1.2: render in an offscreen sibling container, not in a child
// iframe with srcdoc. The iframe approach has a load-event race in
// Chromium (the about:blank load fires before the srcdoc load lands,
// and `once: true` listeners capture the wrong one). The container
// approach is robust and matches what the walker tests use.
//
// The container is a <body> element (not a <div>) so that CSS rules
// targeting `body { ... }` in the user's <style> apply to it — pages
// rely on body for the page background, padding, and font setup. A
// nested body is invalid HTML but valid DOM, and getComputedStyle plus
// getBoundingClientRect work the same. The default user-agent
// `margin: 8px` is reset via inline style.
//
// To stop the plugin UI from inheriting the imported page's body styles
// (which used to flash, e.g. dark UI -> white when importing a page that
// sets `body { background: white }`), we pre-process the HTML and rewrite
// every CSS selector containing `body` as a type selector to
// `body[aria-hidden="true"]`. The aria-hidden attribute is set only on
// the harness container, so scoped rules apply there and not to the
// plugin's outer body. Other selectors (`*`, `.something`) still cascade
// — those are rare causes of visible flash but acceptable for now.
//
// `contain: layout style` blocks layout containment but does not isolate
// CSS rules — that needs Shadow DOM or a real iframe. Revisit if more
// leaks bite.
export async function renderHidden(
  html: string,
  viewportWidth: number
): Promise<RenderHandle> {
  const container = document.createElement('body')
  container.setAttribute('aria-hidden', 'true')
  container.style.cssText = [
    'position: fixed',
    'left: -99999px',
    'top: 0',
    `width: ${viewportWidth}px`,
    'margin: 0',
    'contain: layout style',
    'visibility: visible'
  ].join('; ')
  const scoped = scopeBodyRulesInHtml(html)
  container.innerHTML = scoped
  document.body.appendChild(container)

  // Force a synchronous layout pass before measurements.
  void container.offsetHeight

  try {
    await document.fonts.ready
  } catch {
    // Older browsers or restricted contexts may not expose document.fonts.
    // Font matching becomes best-effort; layout still works.
  }

  return {
    body: container,
    doc: document,
    cleanup: () => container.remove()
  }
}

// Rewrites every `<style>...</style>` block in the HTML string so that
// any `body` CSS type selector becomes `body[aria-hidden="true"]`. We do
// this on the raw string BEFORE injection so the outer plugin UI body
// never even momentarily matches the rule (avoiding a visible flash).
//
// Imperfections:
// - `body` inside CSS comments or string literals is naively replaced.
//   Comments are short and string literals containing the word "body"
//   are vanishingly rare in real CSS.
// - Identifiers that contain "body" (like `.body-text`) are left intact
//   because the regex requires a CSS combinator/separator on each side.
function scopeBodyRulesInHtml(html: string): string {
  return html.replace(
    /<style([^>]*)>([\s\S]*?)<\/style>/gi,
    (_match, attrs: string, css: string) => {
      return `<style${attrs}>${scopeBodyRulesInCss(css)}</style>`
    }
  )
}

const BODY_SELECTOR_RE = /(^|[\s>+~*,])body(?=[\s.#:[\],{>+~]|$)/g

export function scopeBodyRulesInCss(css: string): string {
  return css.replace(BODY_SELECTOR_RE, '$1body[aria-hidden="true"]')
}
