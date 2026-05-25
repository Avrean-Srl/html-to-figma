import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { extractHtmlFromZip } from '../../src/parser/zip'

async function makeZipFile(
  entries: Record<string, string | Uint8Array>
): Promise<File> {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  return new File([blob], 'archive.zip', { type: 'application/zip' })
}

// A 1x1 transparent PNG (real bytes, not just a header). Useful as a
// known-good asset for the asset-inlining test.
const ONE_PX_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

describe('extractHtmlFromZip', () => {
  it('extracts an index.html at the root', async () => {
    const file = await makeZipFile({
      'index.html': '<div>Hello from ZIP</div>'
    })
    const html = await extractHtmlFromZip(file)
    expect(html).toContain('Hello from ZIP')
  })

  it('prefers index.html when multiple .html files are present', async () => {
    const file = await makeZipFile({
      'index.html': '<div>preferred</div>',
      'other.html': '<div>other</div>'
    })
    const html = await extractHtmlFromZip(file)
    expect(html).toContain('preferred')
    expect(html).not.toContain('other</div>')
  })

  it('falls back to the first .html when there is no index.html', async () => {
    const file = await makeZipFile({
      'page.html': '<div>only one</div>'
    })
    const html = await extractHtmlFromZip(file)
    expect(html).toContain('only one')
  })

  it('throws when no .html file is in the archive', async () => {
    const file = await makeZipFile({
      'readme.txt': 'no html here'
    })
    await expect(extractHtmlFromZip(file)).rejects.toThrow(/No .html file/)
  })

  it('inlines a sibling image as a data URL', async () => {
    const file = await makeZipFile({
      'index.html': '<img src="images/photo.png" />',
      'images/photo.png': base64ToBytes(ONE_PX_PNG_B64)
    })
    const html = await extractHtmlFromZip(file)
    expect(html).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]+/)
    expect(html).not.toContain('images/photo.png')
  })

  it('leaves http(s) and data URLs unchanged', async () => {
    const file = await makeZipFile({
      'index.html':
        '<img src="https://example.com/a.jpg" /><img src="data:image/png;base64,AAAA" />'
    })
    const html = await extractHtmlFromZip(file)
    expect(html).toContain('https://example.com/a.jpg')
    expect(html).toContain('data:image/png;base64,AAAA')
  })

  it('resolves ../ traversal in image paths', async () => {
    const file = await makeZipFile({
      'pages/index.html': '<img src="../assets/photo.png" />',
      'assets/photo.png': base64ToBytes(ONE_PX_PNG_B64)
    })
    const html = await extractHtmlFromZip(file)
    expect(html).toMatch(/data:image\/png;base64,/)
  })
})
