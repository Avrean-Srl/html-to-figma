import type { IRDocument, IRImage, IRImageFailure, IRNode } from '../types/ir'

// After the synchronous walker pass we have IRImage nodes with bytes=null
// and loadStatus='pending' for any non-data-url image and loadStatus
// 'data-url' for inline data URLs. This pass fills bytes in by decoding
// data URLs and fetching network URLs in parallel. CORS failures and
// other network errors are caught per-image so a single bad src does
// not fail the whole import.
export async function loadImages(doc: IRDocument): Promise<void> {
  const images = collectImages(doc.root)

  await Promise.all(images.map(async (ir) => {
    if (ir.loadStatus === 'data-url') {
      ir.bytes = decodeDataUrl(ir.sourceUrl)
      if (ir.bytes === null) ir.loadStatus = 'network-error'
      return
    }
    if (ir.loadStatus !== 'pending') return
    const bytes = await fetchImageBytes(ir.sourceUrl)
    if (bytes.kind === 'ok') {
      ir.bytes = bytes.data
      ir.loadStatus = 'ok'
    } else {
      ir.bytes = null
      ir.loadStatus = bytes.reason
    }
  }))

  // Propagate failures to the document-level imageFailures list so the
  // UI can show a single post-import report instead of querying the tree.
  doc.imageFailures = images
    .filter((ir) => ir.bytes === null && ir.loadStatus !== 'data-url')
    .map<IRImageFailure>((ir) => ({
      sourceUrl: ir.sourceUrl,
      // Narrowing: at this point loadStatus is not 'pending' (we awaited),
      // not 'ok', not 'data-url' — it's one of the three failure reasons.
      reason: (ir.loadStatus as 'cors-blocked' | 'network-error' | 'not-found')
    }))
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
    // Plain (URL-encoded) data — encode as UTF-8 bytes.
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
