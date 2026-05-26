import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { extractHtmlFromZip, extractHtmlsFromZip } from '../../src/parser/zip'

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

  it('prefers a shallow index.html over a nested one', async () => {
    const file = await makeZipFile({
      'index.html': '<div>root</div>',
      'docs/index.html': '<div>nested</div>'
    })
    const html = await extractHtmlFromZip(file)
    expect(html).toContain('root')
    expect(html).not.toContain('nested')
  })

  it('finds index.html inside a single top-level folder', async () => {
    const file = await makeZipFile({
      'project/index.html': '<div>inside folder</div>',
      'project/styles.css': '.x { color: red }'
    })
    const html = await extractHtmlFromZip(file)
    expect(html).toContain('inside folder')
  })

  it('inlines a relative <link rel="stylesheet"> as a <style> block', async () => {
    const file = await makeZipFile({
      'index.html':
        '<head><link rel="stylesheet" href="assets/style.css"></head><body><p>x</p></body>',
      'assets/style.css': 'p { color: rgb(255, 0, 0) }'
    })
    const html = await extractHtmlFromZip(file)
    expect(html).not.toMatch(/<link\b[^>]*stylesheet[^>]*>/i)
    expect(html).toContain('<style')
    expect(html).toContain('p { color: rgb(255, 0, 0) }')
  })

  it('inlines a stylesheet inside a nested folder', async () => {
    const file = await makeZipFile({
      'site/index.html':
        '<head><link rel="stylesheet" href="assets/css/styles.css"></head>',
      'site/assets/css/styles.css': '.hero { background: blue }'
    })
    const html = await extractHtmlFromZip(file)
    expect(html).toContain('.hero { background: blue }')
  })

  it('leaves absolute <link rel="stylesheet"> hrefs untouched', async () => {
    const file = await makeZipFile({
      'index.html':
        '<head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"></head>'
    })
    const html = await extractHtmlFromZip(file)
    expect(html).toContain('https://fonts.googleapis.com/css2?family=Inter')
  })

  it('does not inline non-stylesheet <link> tags (preload, icon, etc.)', async () => {
    const file = await makeZipFile({
      'index.html':
        '<head><link rel="icon" href="favicon.png"><link rel="preload" href="hero.png" as="image"></head>',
      'favicon.png': base64ToBytes(ONE_PX_PNG_B64),
      'hero.png': base64ToBytes(ONE_PX_PNG_B64)
    })
    const html = await extractHtmlFromZip(file)
    expect(html).toContain('rel="icon"')
    expect(html).toContain('rel="preload"')
    expect(html).not.toContain('<style')
  })

  it('rewrites url() inside an inlined stylesheet against the CSS directory', async () => {
    const file = await makeZipFile({
      'index.html': '<head><link rel="stylesheet" href="css/styles.css"></head>',
      'css/styles.css':
        '.hero { background-image: url("../img/hero.png") } .icon { background: url(icon.png) }',
      'img/hero.png': base64ToBytes(ONE_PX_PNG_B64),
      'css/icon.png': base64ToBytes(ONE_PX_PNG_B64)
    })
    const html = await extractHtmlFromZip(file)
    expect(html).not.toContain('url("../img/hero.png")')
    expect(html).not.toContain('url(icon.png)')
    expect(html.match(/url\("data:image\/png;base64,/g)?.length).toBe(2)
  })

  it('leaves url() data:, http(s):, and #fragment refs untouched', async () => {
    const file = await makeZipFile({
      'index.html': '<head><link rel="stylesheet" href="s.css"></head>',
      's.css':
        '.a{background:url("data:image/png;base64,AAAA")}' +
        '.b{background:url(https://example.com/x.png)}' +
        '.c{clip-path:url(#myclip)}'
    })
    const html = await extractHtmlFromZip(file)
    expect(html).toContain('data:image/png;base64,AAAA')
    expect(html).toContain('https://example.com/x.png')
    expect(html).toContain('url(#myclip)')
  })

  it('rewrites url() inside an inline <style> block against the HTML directory', async () => {
    const file = await makeZipFile({
      'pages/index.html':
        '<head><style>.hero { background: url("../images/bg.png") no-repeat }</style></head>',
      'images/bg.png': base64ToBytes(ONE_PX_PNG_B64)
    })
    const html = await extractHtmlFromZip(file)
    expect(html).not.toContain('../images/bg.png')
    expect(html).toMatch(/url\("data:image\/png;base64,/)
  })

  it('inlines woff2 fonts referenced from a stylesheet', async () => {
    const file = await makeZipFile({
      'index.html': '<head><link rel="stylesheet" href="fonts.css"></head>',
      'fonts.css':
        "@font-face { font-family: Foo; src: url('assets/foo.woff2') format('woff2') }",
      'assets/foo.woff2': new Uint8Array([1, 2, 3, 4])
    })
    const html = await extractHtmlFromZip(file)
    expect(html).toContain('data:font/woff2;base64,')
    expect(html).not.toContain("url('assets/foo.woff2')")
  })

  it('strips inline and external <script> tags from the HTML', async () => {
    const file = await makeZipFile({
      'index.html':
        '<body><script>window.x = 1</script><div>keep</div><script src="main.js"></script></body>',
      'main.js': 'console.log("x")'
    })
    const html = await extractHtmlFromZip(file)
    expect(html).not.toContain('<script')
    expect(html).toContain('keep')
  })
})

describe('extractHtmlsFromZip (multi-page)', () => {
  it('returns every top-level HTML, index.html first then alphabetical', async () => {
    const file = await makeZipFile({
      'catalogo.html': '<div>catalogo body</div>',
      'index.html': '<div>index body</div>',
      'azienda.html': '<div>azienda body</div>'
    })
    const pages = await extractHtmlsFromZip(file)
    expect(pages.map((p) => p.name)).toEqual([
      'index.html',
      'azienda.html',
      'catalogo.html'
    ])
    expect(pages[0].html).toContain('index body')
    expect(pages[2].html).toContain('catalogo body')
  })

  it('only collects HTMLs in the same directory as the entry index.html', async () => {
    const file = await makeZipFile({
      'site/index.html': '<div>root</div>',
      'site/about.html': '<div>about</div>',
      'site/vendor/lib.html': '<div>vendor</div>',
      'site/.claude/skills/foo.html': '<div>skill</div>'
    })
    const pages = await extractHtmlsFromZip(file)
    expect(pages.map((p) => p.name)).toEqual(['index.html', 'about.html'])
  })

  it('inlines stylesheets and images per page (each page processed independently)', async () => {
    const file = await makeZipFile({
      'index.html':
        '<head><link rel="stylesheet" href="style.css"></head><body><img src="hero.png"></body>',
      'about.html':
        '<head><link rel="stylesheet" href="style.css"></head><body><img src="hero.png"></body>',
      'style.css': '.x { color: red }',
      'hero.png': base64ToBytes(ONE_PX_PNG_B64)
    })
    const pages = await extractHtmlsFromZip(file)
    expect(pages).toHaveLength(2)
    for (const p of pages) {
      expect(p.html).toContain('.x { color: red }')
      expect(p.html).toMatch(/data:image\/png;base64,/)
    }
  })

  it('returns a single page when only one HTML is present', async () => {
    const file = await makeZipFile({
      'page.html': '<div>only</div>'
    })
    const pages = await extractHtmlsFromZip(file)
    expect(pages).toHaveLength(1)
    expect(pages[0].name).toBe('page.html')
  })

  it('throws when no HTML is present', async () => {
    const file = await makeZipFile({ 'readme.txt': 'nope' })
    await expect(extractHtmlsFromZip(file)).rejects.toThrow(/No .html file/)
  })
})
