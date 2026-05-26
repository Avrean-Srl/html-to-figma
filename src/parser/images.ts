import type { IRDocument, IRImage, IRImageFailure, IRNode } from '../types/ir'

import { isGoogleMapsUrl, resolveGoogleMapsToImage } from './map-resolver'

// After the synchronous walker pass we have IRImage nodes with bytes=null
// and loadStatus='pending' for any non-data-url image and loadStatus
// 'data-url' for inline data URLs. This pass fills bytes in by decoding
// data URLs and fetching network URLs in parallel. CORS failures, other
// network errors, AND unsupported image formats are caught per-image so
// a single bad src does not fail the whole import.
export async function loadImages(doc: IRDocument): Promise<void> {
  const images = collectImages(doc.root)

  await Promise.all(images.map(async (ir) => {
    if (ir.loadStatus === 'data-url') {
      const bytes = decodeDataUrl(ir.sourceUrl)
      if (bytes === null) {
        ir.bytes = null
        ir.loadStatus = 'network-error'
        return
      }
      if (!isSupportedImageFormat(bytes)) {
        ir.bytes = null
        ir.loadStatus = 'format-unsupported'
        return
      }
      ir.bytes = bytes
      return
    }
    if (ir.loadStatus !== 'pending') return

    // Google Maps iframe URL? Geocode (Nominatim, OSM, free) and
    // grab a PNG from staticmap.openstreetmap.de instead of fetching
    // the URL directly (which would CORS-fail). The result feeds the
    // same Figma image fill path as a regular `<img src>` import.
    if (isGoogleMapsUrl(ir.sourceUrl)) {
      const map = await resolveGoogleMapsToImage(
        ir.sourceUrl,
        ir.layout.width,
        ir.layout.height
      )
      if (map !== null && isSupportedImageFormat(map.bytes)) {
        ir.bytes = map.bytes
        ir.loadStatus = 'ok'
        return
      }
      ir.bytes = null
      ir.loadStatus = 'network-error'
      return
    }

    const fetched = await fetchImageBytes(ir.sourceUrl)
    if (fetched.kind !== 'ok') {
      ir.bytes = null
      ir.loadStatus = fetched.reason
      return
    }
    if (!isSupportedImageFormat(fetched.data)) {
      ir.bytes = null
      ir.loadStatus = 'format-unsupported'
      return
    }
    ir.bytes = fetched.data
    ir.loadStatus = 'ok'
  }))

  // Propagate failures to the document-level imageFailures list so the
  // UI can show a single post-import report instead of querying the tree.
  doc.imageFailures = images
    .filter((ir) => ir.bytes === null && ir.loadStatus !== 'data-url')
    .map<IRImageFailure>((ir) => ({
      sourceUrl: ir.sourceUrl,
      reason: ir.loadStatus as IRImageFailure['reason']
    }))
}

// Magic-number sniffing for the formats Figma's createImage accepts:
// PNG, JPEG, GIF. WebP, AVIF, SVG, etc. all bounce here.
function isSupportedImageFormat(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false
  // PNG: 89 50 4E 47
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) return true
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true
  // GIF: 47 49 46 38 ("GIF8")
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) return true
  return false
}

function collectImages(node: IRNode): IRImage[] {
  if (node.type === 'image') return [node]
  if (node.type !== 'frame') return []
  const out: IRImage[] = []
  for (const child of node.children) out.push(...collectImages(child))
  return out
}

function decodeDataUrl(url: string): Uint8Array | null {
  // data:[<mediatype>][;base64],<data>
  const match = url.match(/^data:[^;,]*(;base64)?,(.*)$/)
  if (match === null) return null
  const isBase64 = match[1] === ';base64'
  const payload = match[2]
  try {
    if (isBase64) {
      const binary = atob(payload)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return bytes
    }
    // Plain (URL-encoded) data - encode as UTF-8 bytes.
    const decoded = decodeURIComponent(payload)
    return new TextEncoder().encode(decoded)
  } catch {
    return null
  }
}

type FetchResult =
  | { kind: 'ok'; data: Uint8Array }
  | { kind: 'fail'; reason: 'cors-blocked' | 'network-error' | 'not-found' }

async function fetchImageBytes(url: string): Promise<FetchResult> {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) {
      return { kind: 'fail', reason: res.status === 404 ? 'not-found' : 'network-error' }
    }
    const buf = await res.arrayBuffer()
    return { kind: 'ok', data: new Uint8Array(buf) }
  } catch (err) {
    // fetch() rejects on CORS failures and network unreachable. We can't
    // distinguish them precisely from the error alone, so the UI reports
    // the source URL and lets the user diagnose.
    const message = err instanceof Error ? err.message.toLowerCase() : ''
    if (message.includes('cors')) return { kind: 'fail', reason: 'cors-blocked' }
    return { kind: 'fail', reason: 'network-error' }
  }
}
