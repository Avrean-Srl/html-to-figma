export interface RenderHandle {
  body: HTMLElement
  doc: Document
  cleanup: () => void
}

// Phase 1.2: render in an offscreen sibling container, not in a child
// iframe with srcdoc. The iframe approach has a load-event race in
// Chromium (the about:blank load fires before the srcdoc load lands,
// and `once: true` listeners capture the wrong one), and document.write
// is deprecated. The container approach is robust and matches what the
// walker tests use.
//
// Known trade-off: user CSS in <style> tags cascades to the plugin UI
// while the container is mounted. `contain: layout style` blocks layout
// containment but does not isolate CSS rules — that needs Shadow DOM or
// a real iframe. Revisit in Phase 2 if real users report UI flicker.
export async function renderHidden(
  html: string,
  viewportWidth: number
): Promise<RenderHandle> {
  const container = document.createElement('div')
  container.setAttribute('aria-hidden', 'true')
  container.style.cssText = [
    'position: fixed',
    'left: -99999px',
    'top: 0',
    `width: ${viewportWidth}px`,
    'contain: layout style',
    'visibility: visible'
  ].join('; ')
  container.innerHTML = html
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
