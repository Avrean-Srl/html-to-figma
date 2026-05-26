// Resolves a Google Maps iframe URL to a PNG static map - no API key.
//
// Pipeline:
//   1. Extract address (q=) and/or lat/lng from the iframe src.
//   2. If only an address is available, geocode it via Photon (free,
//      OSM-based, CORS-friendly - more permissive than Nominatim which
//      sometimes rejects browser requests). Fall back to Nominatim if
//      Photon is unavailable.
//   3. Compose the static map ourselves from OpenStreetMap raster tiles
//      (https://tile.openstreetmap.org/{z}/{x}/{y}.png). We avoid the
//      community staticmap.openstreetmap.de proxy because it's known
//      to be flaky / down for extended periods.
//
// Everything happens inside the plugin UI iframe (which has
// networkAccess permission via the manifest). Failures cascade through
// to the existing image-failure UI - the importer falls back to a
// missing-image placeholder so a broken map doesn't break the import.

export function isGoogleMapsUrl(url: string): boolean {
  if (!url) return false
  const lower = url.toLowerCase()
  return (
    lower.includes('google.com/maps') ||
    lower.includes('maps.google.com') ||
    lower.includes('google.com/maps/embed')
  )
}

export interface ResolvedMapImage {
  bytes: Uint8Array
}

export async function resolveGoogleMapsToImage(
  url: string,
  widthPx: number,
  heightPx: number
): Promise<ResolvedMapImage | null> {
  try {
    const target = await extractMapTarget(url)
    if (target === null) return null
    const w = Math.max(64, Math.min(Math.round(widthPx), 2048))
    const h = Math.max(64, Math.min(Math.round(heightPx), 2048))
    const bytes = await composeOsmStaticMap(target.lat, target.lon, target.zoom, w, h)
    if (bytes === null) return null
    return { bytes }
  } catch {
    return null
  }
}

interface MapTarget {
  lat: number
  lon: number
  zoom: number
}

async function extractMapTarget(url: string): Promise<MapTarget | null> {
  // Try lat/lng-encoded URLs first (no geocoding round-trip needed).
  const direct = parsePbLatLng(url) ?? parseAtLatLng(url)
  if (direct !== null) return direct

  // Address-based embed: geocode.
  const params = parseQueryParams(url)
  const q = params.q ?? params.query
  if (!q) return null
  const zoom = clampZoom(parseFloat(params.z ?? '15'))

  const geo = (await geocodeViaPhoton(q)) ?? (await geocodeViaNominatim(q))
  if (geo === null) return null
  return { lat: geo.lat, lon: geo.lon, zoom }
}

function parsePbLatLng(url: string): MapTarget | null {
  const m = url.match(/[?&]pb=([^&]+)/)
  if (!m) return null
  const pb = m[1]
  const lonMatch = pb.match(/!2d(-?\d+(?:\.\d+)?)/)
  const latMatch = pb.match(/!3d(-?\d+(?:\.\d+)?)/)
  if (!latMatch || !lonMatch) return null
  return {
    lat: parseFloat(latMatch[1]),
    lon: parseFloat(lonMatch[1]),
    zoom: 15
  }
}

function parseAtLatLng(url: string): MapTarget | null {
  const m = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/)
  if (!m) return null
  return {
    lat: parseFloat(m[1]),
    lon: parseFloat(m[2]),
    zoom: clampZoom(parseFloat(m[3] ?? '15'))
  }
}

function parseQueryParams(url: string): Record<string, string> {
  const qIdx = url.indexOf('?')
  if (qIdx === -1) return {}
  const pairs = url.slice(qIdx + 1).split('&')
  const out: Record<string, string> = {}
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const k = decodeURIComponent(pair.slice(0, eq))
    const v = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '))
    out[k] = v
  }
  return out
}

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 15
  return Math.max(1, Math.min(19, Math.round(z)))
}

// Geocodes via Photon - OSM-based, CORS-enabled, browser-friendly.
async function geocodeViaPhoton(
  address: string
): Promise<{ lat: number; lon: number } | null> {
  try {
    const resp = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(address)}&limit=1`
    )
    if (!resp.ok) return null
    const data = (await resp.json()) as {
      features?: Array<{ geometry?: { coordinates?: [number, number] } }>
    }
    const coords = data.features?.[0]?.geometry?.coordinates
    if (!coords || coords.length !== 2) return null
    const [lon, lat] = coords
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    return { lat, lon }
  } catch {
    return null
  }
}

async function geocodeViaNominatim(
  address: string
): Promise<{ lat: number; lon: number } | null> {
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search` +
        `?q=${encodeURIComponent(address)}` +
        `&format=json` +
        `&limit=1`,
      { headers: { Accept: 'application/json' } }
    )
    if (!resp.ok) return null
    const data = (await resp.json()) as unknown
    if (!Array.isArray(data) || data.length === 0) return null
    const first = data[0] as { lat?: string; lon?: string }
    if (typeof first.lat !== 'string' || typeof first.lon !== 'string') return null
    const lat = parseFloat(first.lat)
    const lon = parseFloat(first.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    return { lat, lon }
  } catch {
    return null
  }
}

// Composes a static map by fetching the surrounding OpenStreetMap
// raster tiles, painting them onto a canvas, and overlaying a red pin
// at the centre. OSM's standard tile server has open CORS and is the
// most stable free option.
//
// Web Mercator math (per the OSM wiki): pixel coordinates at a given
// zoom are derived from longitude / latitude with the standard
// equirectangular-then-Mercator transform.
const TILE_SIZE = 256

async function composeOsmStaticMap(
  lat: number,
  lon: number,
  zoom: number,
  outputWidth: number,
  outputHeight: number
): Promise<Uint8Array | null> {
  const centerPx = latLngToPixels(lat, lon, zoom)
  const topLeftPx = {
    x: centerPx.x - outputWidth / 2,
    y: centerPx.y - outputHeight / 2
  }
  const bottomRightPx = {
    x: topLeftPx.x + outputWidth,
    y: topLeftPx.y + outputHeight
  }
  const startTileX = Math.floor(topLeftPx.x / TILE_SIZE)
  const startTileY = Math.floor(topLeftPx.y / TILE_SIZE)
  const endTileX = Math.floor((bottomRightPx.x - 1) / TILE_SIZE)
  const endTileY = Math.floor((bottomRightPx.y - 1) / TILE_SIZE)

  const tileBitmaps = await Promise.all(
    enumerateTiles(startTileX, startTileY, endTileX, endTileY, zoom).map(
      async ({ x, y, z }) => {
        try {
          const img = await loadOsmTile(z, x, y)
          return { x, y, img }
        } catch {
          return { x, y, img: null as HTMLImageElement | null }
        }
      }
    )
  )
  if (tileBitmaps.every((t) => t.img === null)) return null

  const canvas = document.createElement('canvas')
  canvas.width = outputWidth
  canvas.height = outputHeight
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  for (const { x, y, img } of tileBitmaps) {
    if (img === null) continue
    const tilePxX = x * TILE_SIZE
    const tilePxY = y * TILE_SIZE
    const drawX = tilePxX - topLeftPx.x
    const drawY = tilePxY - topLeftPx.y
    ctx.drawImage(img, drawX, drawY, TILE_SIZE, TILE_SIZE)
  }

  // Centre pin so the map matches what the user expected to see from
  // the Google Maps embed marker.
  drawMarker(ctx, outputWidth / 2, outputHeight / 2)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  )
  if (blob === null) return null
  const buf = await blob.arrayBuffer()
  return new Uint8Array(buf)
}

function latLngToPixels(
  lat: number,
  lon: number,
  zoom: number
): { x: number; y: number } {
  const scale = TILE_SIZE * Math.pow(2, zoom)
  const x = ((lon + 180) / 360) * scale
  const sinLat = Math.sin((lat * Math.PI) / 180)
  const clampedSin = Math.max(-0.9999, Math.min(0.9999, sinLat))
  const y =
    (0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI)) * scale
  return { x, y }
}

function enumerateTiles(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  z: number
): Array<{ x: number; y: number; z: number }> {
  const maxTile = Math.pow(2, z)
  const out: Array<{ x: number; y: number; z: number }> = []
  for (let y = startY; y <= endY; y++) {
    if (y < 0 || y >= maxTile) continue
    for (let x = startX; x <= endX; x++) {
      const wrappedX = ((x % maxTile) + maxTile) % maxTile
      out.push({ x: wrappedX, y, z })
    }
  }
  return out
}

function loadOsmTile(
  z: number,
  x: number,
  y: number
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('tile load failed'))
    // The community URL `tile.openstreetmap.org` returns a 256x256 PNG
    // with permissive CORS. There are subdomains (a/b/c) but they're
    // legacy - the canonical hostname is fine for our usage volume.
    img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
  })
}

// Simple Maki-style pin: red teardrop with a small white dot.
function drawMarker(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number
): void {
  const pinHeight = 28
  const pinRadius = 9
  const tipY = cy
  const headY = tipY - pinHeight
  ctx.save()
  ctx.fillStyle = 'rgb(186, 33, 37)' // boero brand red as the default pin
  ctx.beginPath()
  ctx.moveTo(cx, tipY)
  ctx.quadraticCurveTo(cx + pinRadius, tipY - pinHeight * 0.55, cx, headY)
  ctx.arc(cx, headY, pinRadius, 0, Math.PI * 2)
  ctx.quadraticCurveTo(cx - pinRadius, tipY - pinHeight * 0.55, cx, tipY)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'white'
  ctx.beginPath()
  ctx.arc(cx, headY, 3.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
