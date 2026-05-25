import JSZip from 'jszip'

// Extracts an HTML document from a ZIP and inlines relative image
// assets as data URLs so the existing parser pipeline can consume the
// result without knowing anything about archives. Strategy:
//   1. Find an index.html (or the first .html) entry in the archive.
//   2. Compute its directory prefix so relative paths can be resolved.
//   3. Scan the HTML for <img src="..."> with a non-absolute, non-data
//      URL; for each match, look up the corresponding archive entry,
//      base64-encode its bytes, and substitute a data: URL.
//   4. Return the transformed HTML string.
//
// Limitations (acceptable for v1):
//   - Only <img> srcs are rewritten. <link href> stylesheets, scripts,
//     and CSS url() backgrounds are left alone — they wouldn't render
//     correctly anyway under the iframe sandbox.
//   - No CSS @import resolution.
export async function extractHtmlFromZip(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(buf)

  const htmlEntry = pickHtmlEntry(zip)
  if (htmlEntry === null) {
    throw new Error('No .html file found in the ZIP.')
  }

  const htmlDir = directoryOf(htmlEntry.name)
  let html = await htmlEntry.async('string')

  // Find every img src in source order. We don't dedupe — if the same
  // src appears twice the substitution still works (string split-join).
  const matches: Array<{ raw: string; src: string }> = []
  const regex = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = regex.exec(html)) !== null) {
    matches.push({ raw: m[0], src: m[1] })
  }

  const replacements = new Map<string, string>()
  for (const { src } of matches) {
    if (replacements.has(src)) continue
    if (src.startsWith('http:') || src.startsWith('https:') || src.startsWith('data:')) continue
    const resolved = resolveZipPath(htmlDir, src)
    const asset = zip.files[resolved]
    if (!asset || asset.dir) continue
    const bytes = await asset.async('uint8array')
    const mime = guessMime(src)
    replacements.set(src, `data:${mime};base64,${uint8ToBase64(bytes)}`)
  }

  for (const [original, dataUrl] of Array.from(replacements.entries())) {
    html = html.split(original).join(dataUrl)
  }

  return html
}

function pickHtmlEntry(zip: JSZip): JSZip.JSZipObject | null {
  const paths = Object.keys(zip.files).filter((p) => !zip.files[p].dir)
  // Prefer an index.html at the root or in any folder.
  for (const p of paths) {
    if (p.toLowerCase().endsWith('index.html')) return zip.files[p]
  }
  // Otherwise take the first .html.
  for (const p of paths) {
    if (p.toLowerCase().endsWith('.html') || p.toLowerCase().endsWith('.htm')) {
      return zip.files[p]
    }
  }
  return null
}

function directoryOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i + 1)
}

function resolveZipPath(baseDir: string, relative: string): string {
  // Strip leading ./, handle ../ by popping baseDir segments.
  if (relative.startsWith('/')) return relative.slice(1)
  const baseParts = baseDir.split('/').filter((p) => p.length > 0)
  const relParts = relative.split('/')
  for (const part of relParts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      baseParts.pop()
      continue
    }
    baseParts.push(part)
  }
  return baseParts.join('/')
}

function guessMime(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream'
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  // Chunk to avoid call-stack limits on large images (~32 KB chunks).
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length))
    binary += String.fromCharCode.apply(null, Array.from(slice))
  }
  return btoa(binary)
}
