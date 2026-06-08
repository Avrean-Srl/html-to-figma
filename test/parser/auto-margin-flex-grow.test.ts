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

describe('CSS flex-grow becomes Figma layoutGrow', () => {
  it('marks a `flex: 1` child with layoutGrow = 1', () => {
    const container = setup(`
      <div style="display: flex; gap: 16px; padding: 16px; width: 600px">
        <div style="width: 80px; height: 40px; background: red"></div>
        <div style="flex: 1; height: 40px; background: blue"></div>
        <div style="width: 80px; height: 40px; background: green"></div>
      </div>
    `)
    const result = walkDocument(container, 1440)
    const flexParent = result.root.children[0]
    expect(flexParent.type).toBe('frame')
    if (flexParent.type === 'frame') {
      // Three IR children expected, no spacers injected because flex:1
      // already absorbs the room.
      const ds = flexParent.children
      expect(ds).toHaveLength(3)
      expect(ds[0].layoutGrow ?? 0).toBe(0)
      expect(ds[1].layoutGrow ?? 0).toBe(1)
      expect(ds[2].layoutGrow ?? 0).toBe(0)
    }
  })

  it('leaves layoutGrow at 0 when no child declares flex-grow', () => {
    const container = setup(`
      <div style="display: flex; gap: 8px; padding: 8px">
        <div style="width: 40px; height: 40px; background: red"></div>
        <div style="width: 40px; height: 40px; background: blue"></div>
      </div>
    `)
    const result = walkDocument(container, 1440)
    const flexParent = result.root.children[0]
    if (flexParent.type === 'frame') {
      expect(flexParent.children.every((c) => (c.layoutGrow ?? 0) === 0)).toBe(true)
    }
  })
})

describe('flex children never get bogus spacer siblings', () => {
  it('keeps exactly the original child count on a packed flex row', () => {
    const container = setup(`
      <div style="display: flex; gap: 8px; padding: 8px; width: 200px">
        <div style="width: 40px; height: 40px; background: red"></div>
        <div style="width: 40px; height: 40px; background: blue"></div>
        <div style="width: 40px; height: 40px; background: green"></div>
      </div>
    `)
    const result = walkDocument(container, 1440)
    const flexParent = result.root.children[0]
    if (flexParent.type === 'frame') {
      expect(flexParent.children).toHaveLength(3)
      expect(
        flexParent.children.every(
          (c) => !(c.type === 'frame' && c.sourceTag === 'spacer')
        )
      ).toBe(true)
    }
  })

  it('does not inject a spacer when one child has flex: 1 (handled by layoutGrow)', () => {
    // Spaces between siblings can also appear when the LAST child is
    // grown via flex:1 rather than via margin-auto. Our walker used to
    // mis-detect this as an auto-margin gap; now we rely on the child's
    // own layoutGrow to do the work.
    const container = setup(`
      <div style="display: flex; gap: 8px; padding: 8px; width: 600px">
        <div style="width: 80px; height: 40px; background: red"></div>
        <div style="flex: 1; height: 40px; background: blue"></div>
        <div style="width: 80px; height: 40px; background: green"></div>
      </div>
    `)
    const result = walkDocument(container, 1440)
    const flexParent = result.root.children[0]
    if (flexParent.type === 'frame') {
      expect(flexParent.children).toHaveLength(3)
      // The middle child carries the flex: 1 directly.
      expect(flexParent.children[1].layoutGrow).toBe(1)
    }
  })

  it('does not inject anything in a vertical sidebar with flex:1 nav', () => {
    // Regression: the boero admin sidebar (column flex, brand + chip +
    // nav with flex:1) was getting 2 spacer rows injected because the
    // walker mis-read the nav's grown height as "unexplained" vertical
    // room between siblings.
    const container = setup(`
      <aside style="display: flex; flex-direction: column; width: 260px; height: 800px; padding: 20px 0">
        <a style="height: 92px; background: blue"></a>
        <a style="height: 64px; background: green"></a>
        <nav style="flex: 1; background: red"></nav>
      </aside>
    `)
    const result = walkDocument(container, 1440)
    const sidebar = result.root.children[0]
    if (sidebar.type === 'frame') {
      expect(sidebar.children).toHaveLength(3)
      expect(
        sidebar.children.every(
          (c) => !(c.type === 'frame' && c.sourceTag === 'spacer')
        )
      ).toBe(true)
      // nav carries the layoutGrow=1 cue itself.
      const nav = sidebar.children[2]
      expect(nav.layoutGrow).toBe(1)
    }
  })
})

describe('margin-left: auto detection -> primaryAxisAlign space-between', () => {
  it('converts 2-child flex with big unused gap to space-between', () => {
    // Boero admin topbar: <header style="display:flex">
    //   <nav class="breadcrumb">...</nav>
    //   <div style="margin-left:auto">bell</div>
    // </header>
    const container = setup(`
      <header style="display: flex; gap: 16px; padding: 0 16px; width: 1600px; align-items: center; height: 64px">
        <nav style="font-size: 14px; width: 200px; height: 24px; background: red"></nav>
        <div style="margin-left: auto; width: 32px; height: 32px; background: blue"></div>
      </header>
    `)
    const result = walkDocument(container, 1920)
    const header = result.root.children[0]
    expect(header.type).toBe('frame')
    if (header.type === 'frame' && header.autoLayout) {
      expect(header.autoLayout.primaryAxisAlign).toBe('space-between')
    }
  })

  it('does NOT convert when children are packed without unused space', () => {
    const container = setup(`
      <header style="display: flex; gap: 8px; padding: 0; width: 100px; align-items: center; height: 40px">
        <div style="width: 40px; height: 32px; background: red"></div>
        <div style="width: 40px; height: 32px; background: blue"></div>
      </header>
    `)
    const result = walkDocument(container, 1920)
    const header = result.root.children[0]
    if (header.type === 'frame' && header.autoLayout) {
      expect(header.autoLayout.primaryAxisAlign).toBe('min')
    }
  })

  it('does NOT convert when one child has flex: 1 (grow consumes the gap)', () => {
    const container = setup(`
      <header style="display: flex; gap: 8px; padding: 0; width: 800px; height: 40px">
        <div style="flex: 1; height: 32px; background: red"></div>
        <div style="width: 100px; height: 32px; background: blue"></div>
      </header>
    `)
    const result = walkDocument(container, 1920)
    const header = result.root.children[0]
    if (header.type === 'frame' && header.autoLayout) {
      // First child has layoutGrow=1; no space-between conversion.
      expect(header.autoLayout.primaryAxisAlign).toBe('min')
    }
  })

  it('converts a column flex when the 3rd child is position:absolute (only 2 in-flow)', () => {
    // The .login__left case: flex column with brand at top and a
    // manifest block pushed to the bottom via margin-top:auto. A footer
    // sits at the bottom via position:absolute, so it is OUT of flow -
    // only 2 children participate in the flex distribution, and the
    // auto-margin must resolve to space-between (manifest -> bottom).
    const container = setup(`
      <div style="display: flex; flex-direction: column; width: 800px; height: 900px; padding: 40px 56px; position: relative">
        <a style="height: 22px; background: red"></a>
        <div style="margin-top: auto; height: 300px; background: blue"></div>
        <div style="position: absolute; bottom: 24px; left: 56px; right: 56px; height: 15px; background: green"></div>
      </div>
    `)
    const result = walkDocument(container, 1920)
    const panel = result.root.children[0]
    expect(panel.type).toBe('frame')
    if (panel.type === 'frame' && panel.autoLayout) {
      expect(panel.autoLayout.primaryAxisAlign).toBe('space-between')
    }
  })

  it('does NOT convert a flex-start row with a fixed label + short value (no auto margin)', () => {
    // wizard-step6 sign row: <li class="flex gap-3">
    //   <span style="width:80px">A</span>
    //   <span>Snapshot completo...</span>
    // </li>
    // Plain flex-start with a gap. The value is short so there is large
    // trailing free space, but NEITHER child has an auto margin - it
    // must stay left-aligned, not get shoved to opposite edges.
    const container = setup(`
      <ul style="display: flex; flex-direction: column; gap: 10px; width: 600px">
        <li style="display: flex; align-items: center; gap: 12px">
          <span style="width: 80px; height: 14px; background: red"></span>
          <span style="width: 220px; height: 14px; background: blue"></span>
        </li>
      </ul>
    `)
    const result = walkDocument(container, 1920)
    const ul = result.root.children[0]
    if (ul.type === 'frame') {
      const li = ul.children[0]
      if (li.type === 'frame' && li.autoLayout) {
        expect(li.autoLayout.primaryAxisAlign).toBe('min')
      }
    }
  })

  it('does NOT convert when there are 3 or more in-flow children', () => {
    // 3 children with big gap would imply space-around (CSS Grid grid?
    // designer intent unclear), so we stay safe with 'min'.
    const container = setup(`
      <header style="display: flex; gap: 8px; padding: 0; width: 1000px; height: 40px">
        <div style="width: 100px; height: 32px"></div>
        <div style="width: 100px; height: 32px"></div>
        <div style="width: 100px; height: 32px; margin-left: auto"></div>
      </header>
    `)
    const result = walkDocument(container, 1920)
    const header = result.root.children[0]
    if (header.type === 'frame' && header.autoLayout) {
      expect(header.autoLayout.primaryAxisAlign).toBe('min')
    }
  })
})

describe('lone child under justify-content: space-between', () => {
  it('left-aligns a single-child space-between row (Figma would center it)', () => {
    // .page__head { display:flex; justify-content:space-between } wrapping
    // a single <div> (title + subtitle). CSS packs the lone item to the
    // start; Figma SPACE_BETWEEN would center it. Must resolve to 'min'.
    const container = setup(`
      <div style="display: flex; justify-content: space-between; align-items: flex-end; gap: 32px; width: 1856px">
        <div style="width: 545px; height: 120px; background: red"></div>
      </div>
    `)
    const result = walkDocument(container, 1920)
    const head = result.root.children[0]
    expect(head.type).toBe('frame')
    if (head.type === 'frame' && head.autoLayout) {
      expect(head.autoLayout.primaryAxisAlign).toBe('min')
    }
  })

  it('keeps space-between for a genuine two-child space-between row', () => {
    const container = setup(`
      <div style="display: flex; justify-content: space-between; width: 800px">
        <div style="width: 120px; height: 40px; background: red"></div>
        <div style="width: 120px; height: 40px; background: blue"></div>
      </div>
    `)
    const result = walkDocument(container, 1920)
    const row = result.root.children[0]
    if (row.type === 'frame' && row.autoLayout) {
      expect(row.autoLayout.primaryAxisAlign).toBe('space-between')
    }
  })
})

describe('container sizing hints from CSS display', () => {
  it('flex containers default to FIXED on both axes (pixel-perfect)', () => {
    const container = setup(`
      <div style="display: flex; gap: 8px; padding: 8px; width: 400px">
        <div style="width: 40px; height: 40px; background: red"></div>
      </div>
    `)
    const result = walkDocument(container, 1440)
    const flexParent = result.root.children[0]
    if (flexParent.type === 'frame' && flexParent.autoLayout) {
      expect(flexParent.autoLayout.primaryAxisSizing).toBe('fixed')
      expect(flexParent.autoLayout.counterAxisSizing).toBe('fixed')
    }
  })

  it('inline-flex also stays FIXED (previously HUG, but it drifted on text metrics)', () => {
    const container = setup(`
      <span style="display: inline-flex; gap: 6px; padding: 4px 10px; background: red">
        <span>Attivo</span>
      </span>
    `)
    const result = walkDocument(container, 1440)
    const flexParent = result.root.children[0]
    if (flexParent.type === 'frame' && flexParent.autoLayout) {
      expect(flexParent.autoLayout.primaryAxisSizing).toBe('fixed')
      expect(flexParent.autoLayout.counterAxisSizing).toBe('fixed')
    }
  })
})
