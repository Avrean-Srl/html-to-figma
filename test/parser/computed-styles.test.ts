import { afterEach, describe, expect, it } from 'vitest'

// Smoke tests for the assumption that powers the whole parser:
// getComputedStyle in a real browser returns resolved px values and
// resolved rgb() colors, regardless of how the source CSS was written.
// If these break, the parser breaks. They also prove our Vitest browser
// mode wiring is honest (jsdom would fail every one of these).

const created: HTMLElement[] = []

function mount(el: HTMLElement): void {
  document.body.appendChild(el)
  created.push(el)
}

afterEach(() => {
  while (created.length > 0) {
    const el = created.pop()
    el?.remove()
  }
})

describe('getComputedStyle in real Chromium', () => {
  it('resolves percentage width against parent', () => {
    const parent = document.createElement('div')
    parent.style.cssText = 'width: 400px; position: absolute; left: -99999px;'
    const child = document.createElement('div')
    child.style.width = '50%'
    parent.appendChild(child)
    mount(parent)

    expect(getComputedStyle(child).width).toBe('200px')
  })

  it('resolves rem to px via the root font-size', () => {
    document.documentElement.style.fontSize = '16px'
    const el = document.createElement('span')
    el.style.fontSize = '1.5rem'
    mount(el)

    expect(getComputedStyle(el).fontSize).toBe('24px')
  })

  it('resolves named CSS colors to rgb()', () => {
    const el = document.createElement('div')
    el.style.color = 'rebeccapurple'
    mount(el)

    expect(getComputedStyle(el).color).toBe('rgb(102, 51, 153)')
  })

  it('returns a layout box via getBoundingClientRect', () => {
    const el = document.createElement('div')
    el.style.cssText = 'width: 120px; height: 80px; position: absolute; left: 0; top: 0;'
    mount(el)

    const rect = el.getBoundingClientRect()
    expect(rect.width).toBe(120)
    expect(rect.height).toBe(80)
  })
})
