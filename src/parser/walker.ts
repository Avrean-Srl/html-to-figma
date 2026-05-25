import type {
  IRFontRef,
  IRFrame,
  IRImage,
  IRImageFailure,
  IRLayout,
  IRNode,
  IRSvg,
  IRText,
  ImageLoadStatus
} from '../types/ir'
import { extractAutoLayout } from './auto-layout'
import {
  extractBlendMode,
  extractClipsContent,
  extractCornerRadius,
  extractFills,
  extractFontRef,
  extractLetterSpacing,
  extractLineHeight,
  extractOpacity,
  extractShadows,
  extractStroke,
  extractTextAlign,
  extractTextColor,
  extractTextDecoration,
  extractZIndex,
  hasFrameWorthyStyling,
  isHidden
} from './styles'

// Tags skipped entirely. img and svg are handled specially below.
// Form controls and remaining media (video/audio/canvas/iframe/...) are
// still deferred.
const SKIP_TAGS = new Set([
  'script',
  'style',
  'meta',
  'link',
  'head',
  'title',
  'noscript',
  'template',
  'video',
  'audio',
  'canvas',
  'iframe',
  'object',
  'embed',
  'input',
  'textarea',
  'select',
  'button',
  'form'
])

export interface WalkResult {
  root: IRFrame
  fontsUsed: IRFontRef[]
  imageFailures: IRImageFailure[]
}

export function walkDocument(
  body: HTMLElement,
  viewportWidth: number
): WalkResult {
  const containerRect = body.getBoundingClientRect()
  const fontRefs: IRFontRef[] = []
  let nextId = 0
  const idGen = (): string => `n${nextId++}`

  const children: IRNode[] = []
  for (const child of Array.from(body.children)) {
    const node = walkElement(child, containerRect, idGen, fontRefs)
    if (node !== null) children.push(node)
  }

  const bodyCs = getComputedStyle(body)
  const root: IRFrame = {
    type: 'frame',
    id: idGen(),
    layout: {
      x: 0,
      y: 0,
      width: viewportWidth,
      height: containerRect.height
    },
    opacity: 1,
    hidden: false,
    blendMode: 'normal',
    zIndex: 0,
    sourceTag: 'body',
    fills: extractFills(bodyCs),
    cornerRadius: [0, 0, 0, 0],
    children,
    autoLayout: null,
    shadows: [],
    stroke: null,
    clipsContent: false
  }

  return {
    root,
    fontsUsed: dedupeFontRefs(fontRefs),
    imageFailures: []
  }
}

function walkElement(
  el: Element,
  containerRect: DOMRect,
  idGen: () => string,
  fontRefs: IRFontRef[]
): IRNode | null {
  const tag = el.tagName.toLowerCase()

  if (tag === 'img') return buildImage(el as HTMLImageElement, containerRect, idGen)
  if (tag === 'svg') return buildSvg(el as SVGSVGElement, containerRect, idGen)

  if (SKIP_TAGS.has(tag)) return null

  const cs = getComputedStyle(el)
  if (isHidden(cs)) return null

  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null

  const layout: IRLayout = {
    x: rect.left - containerRect.left,
    y: rect.top - containerRect.top,
    width: rect.width,
    height: rect.height
  }

  const hasElementChildren = Array.from(el.children).some(
    (c) => !SKIP_TAGS.has(c.tagName.toLowerCase())
  )

  if (!hasElementChildren) {
    const text = (el.textContent ?? '').trim()
    if (text.length > 0) {
      // A leaf with text inherits a frame whenever the element carries
      // visual styling (background, radius, padding). Otherwise we'd
      // lose the rendered box. The text child is positioned by Range
      // so it lands inside the padding correctly.
      if (hasFrameWorthyStyling(cs)) {
        const textLayout = rangedLayout(el, containerRect) ?? layout
        const textChild = buildText(cs, textLayout, text, idGen, fontRefs)
        return buildFrame(cs, layout, [textChild], idGen, tag)
      }
      return buildText(cs, layout, text, idGen, fontRefs)
    }
    return buildFrame(cs, layout, [], idGen, tag)
  }

  const children: IRNode[] = []
  for (const childNode of Array.from(el.childNodes)) {
    if (childNode.nodeType === Node.TEXT_NODE) {
      const raw = childNode.textContent ?? ''
      if (raw.trim().length > 0) {
        const textNodes = buildLooseText(
          childNode as Text,
          cs,
          containerRect,
          idGen,
          fontRefs
        )
        for (const n of textNodes) children.push(n)
      }
    } else if (childNode.nodeType === Node.ELEMENT_NODE) {
      const child = walkElement(
        childNode as Element,
        containerRect,
        idGen,
        fontRefs
      )
      if (child !== null) children.push(child)
    }
  }

  return buildFrame(cs, layout, children, idGen, tag)
}

function buildFrame(
  cs: CSSStyleDeclaration,
  layout: IRLayout,
  children: IRNode[],
  idGen: () => string,
  tag: string
): IRFrame {
  return {
    type: 'frame',
    id: idGen(),
    layout,
    opacity: extractOpacity(cs),
    hidden: false,
    blendMode: extractBlendMode(cs),
    zIndex: extractZIndex(cs),
    sourceTag: tag,
    fills: extractFills(cs),
    cornerRadius: extractCornerRadius(cs),
    children,
    autoLayout: extractAutoLayout(cs),
    shadows: extractShadows(cs),
    stroke: extractStroke(cs),
    clipsContent: extractClipsContent(cs)
  }
}

function buildText(
  cs: CSSStyleDeclaration,
  layout: IRLayout,
  text: string,
  idGen: () => string,
  fontRefs: IRFontRef[]
): IRText {
  const fontSize = parseFloat(cs.fontSize) || 16
  const fontRef = extractFontRef(cs)
  fontRefs.push(fontRef)
  return {
    type: 'text',
    id: idGen(),
    layout,
    opacity: extractOpacity(cs),
    hidden: false,
    blendMode: extractBlendMode(cs),
    zIndex: extractZIndex(cs),
    characters: text,
    fontFamily: fontRef.family,
    fontSize,
    fontWeight: fontRef.weight,
    fontStyle: fontRef.style,
    color: extractTextColor(cs),
    letterSpacing: extractLetterSpacing(cs),
    lineHeight: extractLineHeight(cs, fontSize),
    textAlign: extractTextAlign(cs),
    textDecoration: extractTextDecoration(cs)
  }
}

// Returns one IRText per visual line. `Range.getBoundingClientRect()`
// returns the union of all line boxes, which makes a wrapped text node
// look like a tall block overlapping its inline siblings. We instead
// inspect `Range.getClientRects()` (one rect per line) and split the
// node's characters across lines by sampling each char's per-char range
// midpoint Y.
function buildLooseText(
  textNode: Text,
  parentCs: CSSStyleDeclaration,
  containerRect: DOMRect,
  idGen: () => string,
  fontRefs: IRFontRef[]
): IRText[] {
  const doc = textNode.ownerDocument
  if (doc === null) return []

  const range = doc.createRange()
  try {
    range.selectNode(textNode)
  } catch {
    return []
  }

  const clientRects = Array.from(range.getClientRects()).filter(
    (r) => r.width > 0 || r.height > 0
  )
  if (clientRects.length === 0) return []

  const content = textNode.textContent ?? ''
  const lines = splitTextNodeByLineRects(textNode, content, clientRects, doc)

  const fontSize = parseFloat(parentCs.fontSize) || 16
  const fontRef = extractFontRef(parentCs)

  const out: IRText[] = []
  for (const line of lines) {
    // Skip lines that are pure whitespace, but preserve leading/trailing
    // whitespace in the characters of meaningful lines. The line's rect
    // already covers the whitespace width — trimming the characters
    // would make adjacent inline runs visually touch ("Pavel R.deployed"
    // instead of "Pavel R. deployed").
    if (line.text.trim().length === 0) continue
    // Track font usage once per wrapped node, not per line (the line
    // shares one parent style).
    if (out.length === 0) fontRefs.push(fontRef)
    out.push({
      type: 'text',
      id: idGen(),
      layout: {
        x: line.rect.left - containerRect.left,
        y: line.rect.top - containerRect.top,
        width: line.rect.width,
        height: line.rect.height
      },
      opacity: extractOpacity(parentCs),
      hidden: false,
      blendMode: extractBlendMode(parentCs),
      zIndex: extractZIndex(parentCs),
      characters: line.text,
      fontFamily: fontRef.family,
      fontSize,
      fontWeight: fontRef.weight,
      fontStyle: fontRef.style,
      color: extractTextColor(parentCs),
      letterSpacing: extractLetterSpacing(parentCs),
      lineHeight: extractLineHeight(parentCs, fontSize),
      textAlign: extractTextAlign(parentCs),
      textDecoration: extractTextDecoration(parentCs)
    })
  }
  return out
}

// Buckets the characters of a text node by which client rect (line)
// their midpoint Y falls in. O(N) over text length, but real-world DOM
// text nodes are short.
function splitTextNodeByLineRects(
  textNode: Text,
  content: string,
  lineRects: DOMRect[],
  doc: Document
): Array<{ text: string; rect: DOMRect }> {
  if (lineRects.length === 1) {
    return [{ text: content, rect: lineRects[0] }]
  }

  const lineTexts: string[] = lineRects.map(() => '')
  const sorted = lineRects
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.top - b.r.top)

  const charRange = doc.createRange()
  for (let i = 0; i < content.length; i++) {
    try {
      charRange.setStart(textNode, i)
      charRange.setEnd(textNode, i + 1)
    } catch {
      continue
    }
    const charRect = charRange.getBoundingClientRect()
    const midY = charRect.top + charRect.height / 2

    // Find the line rect whose vertical band contains midY. Fall back
    // to the closest line by distance if the char midpoint lies between
    // line boxes (rare with line-height > 1).
    let chosen = sorted[0].i
    let bestDist = Math.abs(midY - (sorted[0].r.top + sorted[0].r.height / 2))
    for (let k = 1; k < sorted.length; k++) {
      const l = sorted[k].r
      if (midY >= l.top && midY <= l.bottom) {
        chosen = sorted[k].i
        bestDist = 0
        break
      }
      const d = Math.abs(midY - (l.top + l.height / 2))
      if (d < bestDist) {
        bestDist = d
        chosen = sorted[k].i
      }
    }
    lineTexts[chosen] += content[i]
  }

  return lineRects.map((rect, i) => ({ text: lineTexts[i], rect }))
}

function buildImage(
  el: HTMLImageElement,
  containerRect: DOMRect,
  idGen: () => string
): IRImage | null {
  if (!el.src) return null

  const cs = getComputedStyle(el)
  if (isHidden(cs)) return null

  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null

  const layout: IRLayout = {
    x: rect.left - containerRect.left,
    y: rect.top - containerRect.top,
    width: rect.width,
    height: rect.height
  }

  const isDataUrl = el.src.startsWith('data:')
  const status: ImageLoadStatus = isDataUrl ? 'data-url' : 'pending'

  return {
    type: 'image',
    id: idGen(),
    layout,
    opacity: extractOpacity(cs),
    hidden: false,
    blendMode: extractBlendMode(cs),
    zIndex: extractZIndex(cs),
    sourceUrl: el.src,
    bytes: null,
    loadStatus: status,
    objectFit: mapObjectFit(cs.objectFit)
  }
}

function buildSvg(
  el: SVGSVGElement,
  containerRect: DOMRect,
  idGen: () => string
): IRSvg | null {
  const cs = getComputedStyle(el)
  if (isHidden(cs)) return null

  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null

  const layout: IRLayout = {
    x: rect.left - containerRect.left,
    y: rect.top - containerRect.top,
    width: rect.width,
    height: rect.height
  }

  return {
    type: 'svg',
    id: idGen(),
    layout,
    opacity: extractOpacity(cs),
    hidden: false,
    blendMode: extractBlendMode(cs),
    zIndex: extractZIndex(cs),
    svg: el.outerHTML
  }
}

function mapObjectFit(
  v: string
): 'fill' | 'contain' | 'cover' | 'none' | 'scale-down' {
  switch (v) {
    case 'contain':
      return 'contain'
    case 'cover':
      return 'cover'
    case 'none':
      return 'none'
    case 'scale-down':
      return 'scale-down'
    default:
      return 'fill'
  }
}

function rangedLayout(el: Element, containerRect: DOMRect): IRLayout | null {
  const range = el.ownerDocument?.createRange()
  if (!range) return null
  try {
    range.selectNodeContents(el)
  } catch {
    return null
  }
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return {
    x: rect.left - containerRect.left,
    y: rect.top - containerRect.top,
    width: rect.width,
    height: rect.height
  }
}

function dedupeFontRefs(refs: IRFontRef[]): IRFontRef[] {
  const seen = new Set<string>()
  const out: IRFontRef[] = []
  for (const ref of refs) {
    const key = `${ref.family}|${ref.weight}|${ref.style}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(ref)
    }
  }
  return out
}
