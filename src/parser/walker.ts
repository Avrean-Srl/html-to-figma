import type {
  IRFontRef,
  IRFrame,
  IRImageFailure,
  IRLayout,
  IRNode,
  IRText
} from '../types/ir'
import { extractAutoLayout } from './auto-layout'
import {
  extractCornerRadius,
  extractFills,
  extractFontRef,
  extractLetterSpacing,
  extractLineHeight,
  extractOpacity,
  extractTextAlign,
  extractTextColor,
  extractTextDecoration,
  hasFrameWorthyStyling,
  isHidden
} from './styles'

// Tags skipped entirely in Phase 1.2. Media (img/svg/video/...) is
// Phase 4; form controls land later. Non-visible head tags never carry
// renderable boxes so they would be filtered anyway, but skipping by
// tag is cheaper than computing styles to discover that.
const SKIP_TAGS = new Set([
  'script',
  'style',
  'meta',
  'link',
  'head',
  'title',
  'noscript',
  'template',
  'img',
  'svg',
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
    sourceTag: 'body',
    fills: extractFills(bodyCs),
    cornerRadius: [0, 0, 0, 0],
    children,
    autoLayout: null
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
        const textNode = buildLooseText(
          childNode as Text,
          cs,
          containerRect,
          raw.trim(),
          idGen,
          fontRefs
        )
        if (textNode !== null) children.push(textNode)
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
    sourceTag: tag,
    fills: extractFills(cs),
    cornerRadius: extractCornerRadius(cs),
    children,
    autoLayout: extractAutoLayout(cs)
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

function buildLooseText(
  textNode: Text,
  parentCs: CSSStyleDeclaration,
  containerRect: DOMRect,
  text: string,
  idGen: () => string,
  fontRefs: IRFontRef[]
): IRText | null {
  const range = textNode.ownerDocument?.createRange()
  if (!range) return null
  try {
    range.selectNode(textNode)
  } catch {
    return null
  }
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null

  const layout: IRLayout = {
    x: rect.left - containerRect.left,
    y: rect.top - containerRect.top,
    width: rect.width,
    height: rect.height
  }

  const fontSize = parseFloat(parentCs.fontSize) || 16
  const fontRef = extractFontRef(parentCs)
  fontRefs.push(fontRef)

  return {
    type: 'text',
    id: idGen(),
    layout,
    opacity: extractOpacity(parentCs),
    hidden: false,
    characters: text,
    fontFamily: fontRef.family,
    fontSize,
    fontWeight: fontRef.weight,
    fontStyle: fontRef.style,
    color: extractTextColor(parentCs),
    letterSpacing: extractLetterSpacing(parentCs),
    lineHeight: extractLineHeight(parentCs, fontSize),
    textAlign: extractTextAlign(parentCs),
    textDecoration: extractTextDecoration(parentCs)
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
