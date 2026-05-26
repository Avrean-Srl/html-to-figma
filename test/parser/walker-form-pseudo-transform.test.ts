import { afterEach, describe, expect, it } from 'vitest'

import { walkDocument } from '../../src/parser/walker'

const mounted: HTMLElement[] = []

function setup(html: string, viewportWidth = 1440): HTMLElement {
  const container = document.createElement('div')
  container.style.cssText = `position: absolute; left: -99999px; top: 0; width: ${viewportWidth}px;`
  container.innerHTML = html
  document.body.appendChild(container)
  mounted.push(container)
  return container
}

afterEach(() => {
  while (mounted.length > 0) {
    const el = mounted.pop()
    el?.remove()
  }
})

describe('form controls (button, input, select, textarea) are walked, not skipped', () => {
  it('emits an IRFrame for a styled <button>', () => {
    const container = setup(
      '<button style="background: rgb(186,33,37); padding: 8px 16px; border: none; border-radius: 6px; color: white">Invita utente</button>'
    )
    const result = walkDocument(container, 1440)
    const button = result.root.children[0]
    expect(button.type).toBe('frame')
    if (button.type === 'frame') {
      expect(button.sourceTag).toBe('button')
      expect(button.fills.length).toBeGreaterThan(0)
      // Should contain the button label as a text child.
      const text = button.children.find((c) => c.type === 'text')
      expect(text).toBeDefined()
      if (text && text.type === 'text') {
        expect(text.characters).toContain('Invita utente')
      }
    }
  })

  it('emits a Text child carrying the placeholder for an empty <input>', () => {
    const container = setup(
      '<input type="search" placeholder="Cerca per nome o email..." style="width: 300px; height: 40px; padding: 8px 12px; border: 1px solid #ccc; border-radius: 6px">'
    )
    const result = walkDocument(container, 1440)
    const input = result.root.children[0]
    expect(input.type).toBe('frame')
    if (input.type === 'frame') {
      expect(input.sourceTag).toBe('input')
      const text = input.children.find((c) => c.type === 'text')
      expect(text).toBeDefined()
      if (text && text.type === 'text') {
        expect(text.characters).toBe('Cerca per nome o email...')
      }
    }
  })

  it('uses input value when set, falling back to placeholder', () => {
    const inputEl = document.createElement('input')
    inputEl.type = 'text'
    inputEl.placeholder = 'fallback'
    inputEl.value = 'live value'
    inputEl.style.cssText =
      'width: 200px; height: 32px; padding: 6px; border: 1px solid #000'
    const container = setup('')
    container.appendChild(inputEl)

    const result = walkDocument(container, 1440)
    const input = result.root.children[0]
    if (input?.type === 'frame') {
      const text = input.children.find((c) => c.type === 'text')
      if (text && text.type === 'text') {
        expect(text.characters).toBe('live value')
      }
    }
  })

  it('renders <select> with its currently selected option', () => {
    const container = setup(
      `<select style="padding: 6px 12px; border: 1px solid #ccc">
        <option>Tutti</option>
        <option selected>Solo attivi</option>
        <option>Solo bloccati</option>
      </select>`
    )
    const result = walkDocument(container, 1440)
    const select = result.root.children[0]
    if (select?.type === 'frame') {
      const text = select.children.find((c) => c.type === 'text')
      if (text && text.type === 'text') {
        expect(text.characters).toBe('Solo attivi')
      }
    }
  })

  it('walks <form> contents instead of dropping the whole subtree', () => {
    const container = setup(
      `<form>
        <button style="padding: 8px 16px; background: blue; color: white">Submit</button>
       </form>`
    )
    const result = walkDocument(container, 1440)
    const form = result.root.children[0]
    expect(form.type).toBe('frame')
    if (form.type === 'frame') {
      expect(form.sourceTag).toBe('form')
      const button = form.children.find(
        (c) => c.type === 'frame' && c.sourceTag === 'button'
      )
      expect(button).toBeDefined()
    }
  })
})

describe('CSS text-transform is applied at extraction time', () => {
  it('uppercases textContent when text-transform: uppercase is set', () => {
    const container = setup(
      '<div style="text-transform: uppercase">utente</div>'
    )
    const result = walkDocument(container, 1440)
    const node = result.root.children[0]
    if (node.type === 'text') {
      expect(node.characters).toBe('UTENTE')
    } else if (node.type === 'frame') {
      const text = node.children.find((c) => c.type === 'text')
      if (text && text.type === 'text') expect(text.characters).toBe('UTENTE')
    }
  })

  it('lowercases textContent when text-transform: lowercase is set', () => {
    const container = setup(
      '<div style="text-transform: lowercase">HELLO World</div>'
    )
    const result = walkDocument(container, 1440)
    const node = result.root.children[0]
    if (node.type === 'text') expect(node.characters).toBe('hello world')
  })

  it('capitalizes per word when text-transform: capitalize is set', () => {
    const container = setup(
      '<div style="text-transform: capitalize">hello world ciao</div>'
    )
    const result = walkDocument(container, 1440)
    const node = result.root.children[0]
    if (node.type === 'text') expect(node.characters).toBe('Hello World Ciao')
  })
})

describe('::before / ::after pseudo-elements emit synthetic frames', () => {
  it('renders a status pill dot from a ::before with content: ""', () => {
    // The boero pattern: `.status::before { content: ""; width: 6px;
    // height: 6px; background: green; border-radius: 50% }`
    const container = setup(`
      <style>
        .status { padding: 4px 10px; background: rgb(220, 255, 220); border-radius: 999px; display: inline-flex; align-items: center; gap: 6px; }
        .status::before {
          content: "";
          display: inline-block;
          width: 6px;
          height: 6px;
          background: rgb(0, 180, 0);
          border-radius: 50%;
        }
      </style>
      <span class="status">Attivo</span>
    `)
    const result = walkDocument(container, 1440)
    const pill = result.root.children[0]
    expect(pill.type).toBe('frame')
    if (pill.type === 'frame') {
      const dot = pill.children.find(
        (c) => c.type === 'frame' && c.sourceTag === 'before'
      )
      expect(dot).toBeDefined()
      if (dot && dot.type === 'frame') {
        expect(dot.layout.width).toBe(6)
        expect(dot.layout.height).toBe(6)
        expect(dot.fills.length).toBeGreaterThan(0)
      }
    }
  })

  it('skips pseudo-elements that paint nothing (no fill, no border)', () => {
    const container = setup(`
      <style>
        .x::before { content: ""; width: 4px; height: 4px; }
      </style>
      <span class="x">visible</span>
    `)
    const result = walkDocument(container, 1440)
    const span = result.root.children[0]
    if (span.type === 'frame') {
      const synthetic = span.children.find(
        (c) => c.type === 'frame' && c.sourceTag === 'before'
      )
      expect(synthetic).toBeUndefined()
    }
  })
})
