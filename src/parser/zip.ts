import JSZip from 'jszip'

// Extracts an HTML document from a ZIP and inlines its relative assets so
// the parser pipeline (which operates on a single HTML string injected
// into an offscreen container) renders the page faithfully. Without this
// step, real-world archives - that ship external stylesheets, images,
// fonts, and CSS url() backgrounds - would render unstyled and the IR
// would be a tower of 100% width auto-sized boxes.
//
// Pipeline:
//   1. Pick the entry HTML (prefer index.html anywhere in the archive,
//      then fall back to the first .html / .htm).
//   2. Strip <script> blocks. They cannot execute usefully in the
//      offscreen container, and bare <script src> would 404.
//   3. Inline every relative <link rel="stylesheet"> by replacing the
//      tag with a <style> block holding the CSS, with url() tokens
//      rewritten to data URLs resolved against the CSS file's directory.
//   4. Rewrite url() inside inline <style> blocks against the HTML's
//      directory.
//   5. Rewrite relative <img src>.
//
// Absolute http(s):// and data: references are intentionally left alone
// so external resources like Google Fonts keep working when networkAccess
// permits.
//
// Limitations (acceptable for v1):
//   - CSS @import is not resolved.
//   - srcset, <picture>, <source> are not rewritten.
//   - url() inside HTML style="..." attributes is not rewritten.

export interface ZipPage {
  // Filename only (e.g. "index.html"), no directory prefix.
  name: string
  // HTML string with relative assets already inlined.
  html: string
}

// Returns the single best HTML page from the archive, inlined. Used by
// flows that only want one page (the prior contract). For multi-page
// archives use extractHtmlsFromZip below.
export async function extractHtmlFromZip(file: File): Promise<string> {
  const pages = await extractHtmlsFromZip(file)
  if (pages.length === 0) {
    throw new Error('No .html file found in the ZIP.')
  }
  return pages[0].html
}

// Returns every top-level HTML page in the archive (the ones in the same
// folder as index.html), each with relative assets inlined. index.html is
// always first; the rest are alphabetical. Useful for importing a whole
// multi-page mockup as side-by-side frames in Figma.
export async function extractHtmlsFromZip(file: File): Promise<ZipPage[]> {
  const buf = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(buf)

  const entryEntry = pickHtmlEntry(zip)
  if (entryEntry === null) {
    throw new Error('No .html file found in the ZIP.')
  }

  const entryDir = directoryOf(entryEntry.name)
  const siblings = collectSiblingHtmls(zip, entryDir)

  const pages: ZipPage[] = []
  for (const path of siblings) {
    const raw = await zip.files[path].async('string')
    const inlined = await processHtmlContent(raw, zip, directoryOf(path))
    pages.push({ name: filenameOf(path), html: inlined })
  }
  return pages
}

// Picks every .html / .htm entry in the same directory as the entry HTML,
// then sorts: index.html first, then alphabetical. We restrict to the
// entry's directory so a mockup zip with `.claude/...` or `node_modules/`
// folders doesn't accidentally import vendor HTMLs.
function collectSiblingHtmls(zip: JSZip, entryDir: string): string[] {
  const paths = Object.keys(zip.files).filter((p) => !zip.files[p].dir)
  const siblings = paths.filter(
    (p) => /\.(html?|htm)$/i.test(p) && directoryOf(p) === entryDir
  )
  siblings.sort((a, b) => {
    const aIsIndex = a.toLowerCase().endsWith('index.html')
    const bIsIndex = b.toLowerCase().endsWith('index.html')
    if (aIsIndex && !bIsIndex) return -1
    if (bIsIndex && !aIsIndex) return 1
    return a.localeCompare(b)
  })
  return siblings
}

async function processHtmlContent(
  raw: string,
  zip: JSZip,
  htmlDir: string
): Promise<string> {
  let html = stripScripts(raw)
  html = await inlineStylesheetLinks(html, zip, htmlDir)
  html = await rewriteInlineStyleBlocks(html, zip, htmlDir)
  html = await inlineImageSrcs(html, zip, htmlDir)
  return html
}

function filenameOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

function stripScripts(html: string): string {
  let out = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  out = out.replace(/<script\b[^>]*\/>/gi, '')
  return out
}

async function inlineStylesheetLinks(
  html: string,
  zip: JSZip,
  htmlDir: string
): Promise<string> {
  // Match every <link ...> tag and decide per-tag whether to inline.
  const linkRegex = /<link\b[^>]*?>/gi
  const tags: string[] = []
  let m: RegExpExecArray | null
  while ((m = linkRegex.exec(html)) !== null) tags.push(m[0])

  const seen = new Set<string>()
  const replacements: Array<{ raw: string; replacement: string }> = []

  for (const raw of tags) {
    if (seen.has(raw)) continue
    seen.add(raw)
    const rel = readAttr(raw, 'rel')
    if (!rel || !/(^|\s)stylesheet(\s|$)/i.test(rel)) continue
    const href = readAttr(raw, 'href')
    if (!href || isAbsoluteOrData(href)) continue
    const resolved = resolveZipPath(htmlDir, href)
    const asset = zip.files[resolved]
    if (!asset || asset.dir) continue
    const css = await asset.async('string')
    const cssDir = directoryOf(resolved)
    const rewritten = await rewriteCssUrls(css, zip, cssDir)
    replacements.push({
      raw,
      replacement: `<style data-from-zip="${escapeAttr(resolved)}">\n${rewritten}\n</style>`
    })
  }

  let out = html
  for (const { raw, replacement } of replacements) {
    // Use split/join so we don't re-interpret regex meta characters.
    out = out.split(raw).join(replacement)
  }
  return out
}

async function rewriteInlineStyleBlocks(
  html: string,
  zip: JSZip,
  htmlDir: string
): Promise<string> {
  const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  const blocks: Array<{ raw: string; body: string }> = []
  let m: RegExpExecArray | null
  while ((m = styleRegex.exec(html)) !== null) {
    blocks.push({ raw: m[0], body: m[1] })
  }
  let out = html
  for (const { raw, body } of blocks) {
    if (!/url\(/i.test(body)) continue
    const rewritten = await rewriteCssUrls(body, zip, htmlDir)
    if (rewritten === body) continue
    const newRaw = raw.replace(body, rewritten)
    out = out.split(raw).join(newRaw)
  }
  return out
}

async function inlineImageSrcs(
  html: string,
  zip: JSZip,
  htmlDir: string
): Promise<string> {
  const matches: Array<{ src: string }> = []
  const regex = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = regex.exec(html)) !== null) {
    matches.push({ src: m[1] })
  }
  const replacements = new Map<string, string>()
  for (const { src } of matches) {
    if (replacements.has(src)) continue
    if (isAbsoluteOrData(src)) continue
    const resolved = resolveZipPath(htmlDir, src)
    const asset = zip.files[resolved]
    if (!asset || asset.dir) continue
    const bytes = await asset.async('uint8array')
    const mime = guessMime(src)
    replacements.set(src, `data:${mime};base64,${uint8ToBase64(bytes)}`)
  }
  let out = html
  for (const [original, dataUrl] of Array.from(replacements.entries())) {
    out = out.split(original).join(dataUrl)
  }
  return out
}

// Walks every url(...) token in a CSS string. Relative refs become
// data: URLs sourced from the ZIP; absolute, data:, and fragment-only
// (#myclip used for SVG defs) refs are left untouched. Unresolved refs
// stay as-is so a missing-asset diagnostic still surfaces in the parser.
async function rewriteCssUrls(
  css: string,
  zip: JSZip,
  cssDir: string
): Promise<string> {
  const urlRegex = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi
  const refs: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = urlRegex.exec(css)) !== null) {
    const ref = m[2].trim()
    if (seen.has(ref)) continue
    if (isAbsoluteOrData(ref) || ref.startsWith('#')) continue
    seen.add(ref)
    refs.push(ref)
  }

  const replacements = new Map<string, string>()
  for (const ref of refs) {
    const resolved = resolveZipPath(cssDir, ref)
    const asset = zip.files[resolved]
    if (!asset || asset.dir) continue
    const bytes = await asset.async('uint8array')
    const mime = guessMime(ref)
    replacements.set(ref, `data:${mime};base64,${uint8ToBase64(bytes)}`)
  }

  if (replacements.size === 0) return css

  return css.replace(urlRegex, (full: string, _q: string, ref: string) => {
    const dataUrl = replacements.get(ref.trim())
    if (!dataUrl) return full
    return `url("${dataUrl}")`
  })
}

function pickHtmlEntry(zip: JSZip): JSZip.JSZipObject | null {
  const paths = Object.keys(zip.files).filter((p) => !zip.files[p].dir)
  // Prefer the shallowest index.html so a top-level entry beats a buried one.
  const indexEntries = paths
    .filter((p) => p.toLowerCase().endsWith('index.html'))
    .sort((a, b) => depthOf(a) - depthOf(b) || a.length - b.length)
  if (indexEntries.length > 0) return zip.files[indexEntries[0]]
  // Otherwise pick the first .html / .htm (also shallowest).
  const htmls = paths
    .filter((p) => /\.(html?|htm)$/i.test(p))
    .sort((a, b) => depthOf(a) - depthOf(b) || a.length - b.length)
  if (htmls.length > 0) return zip.files[htmls[0]]
  return null
}

function depthOf(path: string): number {
  let n = 0
  for (let i = 0; i < path.length; i++) if (path[i] === '/') n++
  return n
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

function readAttr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const m = re.exec(tag)
  if (!m) return null
  return m[2] ?? m[3] ?? m[4] ?? null
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;')
}

function isAbsoluteOrData(ref: string): boolean {
  return (
    ref.startsWith('http:') ||
    ref.startsWith('https:') ||
    ref.startsWith('data:') ||
    ref.startsWith('//')
  )
}

function guessMime(filename: string): string {
  // Strip query/hash before reading the extension.
  const clean = filename.split('?')[0].split('#')[0]
  const ext = clean.toLowerCase().split('.').pop() ?? ''
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
    case 'avif':
      return 'image/avif'
    case 'woff':
      return 'font/woff'
    case 'woff2':
      return 'font/woff2'
    case 'ttf':
      return 'font/ttf'
    case 'otf':
      return 'font/otf'
    case 'eot':
      return 'application/vnd.ms-fontobject'
    case 'css':
      return 'text/css'
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
