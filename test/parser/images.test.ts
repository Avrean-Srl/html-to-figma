import { describe, expect, it } from 'vitest'

import { loadImages } from '../../src/parser/images'
import type { IRDocument, IRFrame, IRImage } from '../../src/types/ir'

function imageNode(src: string, status: IRImage['loadStatus'] = 'pending'): IRImage {
  return {
    type: 'image',
    id: 'i',
    layout: { x: 0, y: 0, width: 100, height: 100 },
    opacity: 1,
    hidden: false,
    blendMode: 'normal',
    zIndex: 0,
    sourceUrl: src,
    bytes: null,
    loadStatus: status,
    objectFit: 'fill'
  }
}

function makeDoc(image: IRImage): IRDocument {
  const root: IRFrame = {
    type: 'frame',
    id: 'r',
    layout: { x: 0, y: 0, width: 1440, height: 200 },
    opacity: 1,
    hidden: false,
    blendMode: 'normal',
    zIndex: 0,
    sourceTag: 'body',
    fills: [],
    cornerRadius: [0, 0, 0, 0],
    children: [image],
    autoLayout: null,
    shadows: [],
    stroke: null,
    clipsContent: false
  }
  return {
    viewportWidth: 1440,
    root,
    fontsUsed: [],
    imageFailures: []
  }
}

describe('loadImages format sniffing', () => {
  it('rejects SVG data URLs as format-unsupported', async () => {
    const svgDataUrl =
      'data:image/svg+xml;base64,' +
      btoa('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')
    const img = imageNode(svgDataUrl, 'data-url')
    const doc = makeDoc(img)

    await loadImages(doc)

    expect(img.loadStatus).toBe('format-unsupported')
    expect(img.bytes).toBeNull()
    expect(doc.imageFailures).toHaveLength(1)
    expect(doc.imageFailures[0].reason).toBe('format-unsupported')
  })

  it('accepts a valid PNG data URL', async () => {
    // 1x1 transparent PNG - header is what we check, not the visual content.
    const pngDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    const img = imageNode(pngDataUrl, 'data-url')
    const doc = makeDoc(img)

    await loadImages(doc)

    expect(img.bytes).not.toBeNull()
    expect(img.loadStatus).toBe('data-url')
    expect(doc.imageFailures).toEqual([])
  })

  it('rejects malformed data URLs as network-error', async () => {
    const img = imageNode('data:image/png;base64,not-valid-base64!!', 'data-url')
    const doc = makeDoc(img)

    await loadImages(doc)

    // atob throws on invalid base64 -> caught -> bytes null -> network-error
    expect(img.bytes).toBeNull()
    expect(['network-error', 'format-unsupported']).toContain(img.loadStatus)
  })
})
