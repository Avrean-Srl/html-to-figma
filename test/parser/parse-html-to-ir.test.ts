import { describe, expect, it } from 'vitest'

import { parseHtmlToIR } from '../../src/parser'

describe('parseHtmlToIR (Phase 1.1 stub)', () => {
  it('returns an empty IRDocument with the requested viewport width', async () => {
    const ir = await parseHtmlToIR('<div>hi</div>', { viewportWidth: 1440 })

    expect(ir.viewportWidth).toBe(1440)
    expect(ir.fontsUsed).toEqual([])
    expect(ir.imageFailures).toEqual([])
  })

  it('produces a root frame sized to the viewport with no children yet', async () => {
    const ir = await parseHtmlToIR('<div>hi</div>', { viewportWidth: 768 })

    expect(ir.root.type).toBe('frame')
    expect(ir.root.layout.width).toBe(768)
    expect(ir.root.layout.x).toBe(0)
    expect(ir.root.layout.y).toBe(0)
    expect(ir.root.children).toEqual([])
    expect(ir.root.autoLayout).toBeNull()
  })
})
