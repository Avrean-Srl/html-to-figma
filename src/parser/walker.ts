import type {
  IRAutoLayout,
  IRColor,
  IRFontRef,
  IRFrame,
  IRImage,
  IRImageFailure,
  IRLayout,
  IRNode,
  IRSvg,
  IRText,
  IRTextRange,
  ImageLoadStatus
} from '../types/ir'
import { extractAutoLayout } from './auto-layout'
import { parseColor } from './color'
import { isGoogleMapsUrl } from './map-resolver'
import {
  extractBlendMode,
  extractClipsContent,
  extractCornerRadius,
  extractFills,
  extractFontFamily,
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
// Form controls (button/input/select/textarea/form) and `<a>` USED to be
// skipped here, which made every "Invita utente" button on a real admin
// page disappear. They're now walked like regular boxes - the parser
// reads computed background/padding/border like any styled div. Inputs
// also get a synthetic placeholder text child so the search bar shows
// "Cerca utente..." instead of an empty rounded rectangle.
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
  'canvas'
])

// Tags we can't render real content for (cross-origin iframe DOM,
// proprietary embed types) but that still take up layout space. We
// emit a styled placeholder frame so the surrounding layout remains
// visually correct. The Google Maps iframe in contatti.html was the
// motivating example - dropping it left a content gap mid-page.
const PLACEHOLDER_TAGS = new Set(['iframe', 'object', 'embed'])

// Form controls that walk like regular elements but need special
// post-processing (placeholder text, etc.). Kept separate from
// SKIP_TAGS so the dispatch in walkElement can pick them off.
const FORM_INPUT_TAGS = new Set(['input', 'textarea', 'select'])

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
  // containerRect.height is the body's BORDER-BOX height, which a global
  // `html, body { height: 100% }` pins to the viewport (e.g. 900px) even
  // when the page's content is taller - a `.app { min-height: 100vh }`
  // grid that grows past the fold is the common case. The harness also
  // sets `overflow: hidden`, so the overflow is clipped in measurement but
  // NOT in the box height. Result: the root frame came out viewport-tall
  // and every child below the fold spilled out the bottom. scrollHeight
  // reports the true content extent (it counts clipped overflow), so the
  // page frame now contains all of its content.
  const rootHeight = Math.max(containerRect.height, body.scrollHeight)
  const root: IRFrame = {
    type: 'frame',
    id: idGen(),
    layout: {
      x: 0,
      y: 0,
      width: viewportWidth,
      height: rootHeight
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

// Public walk entry. Delegates the heavy lifting to walkElementInner and,
// on the way out, tags the produced node with any internal navigation
// href so the mapper can later wire a Figma prototype reaction. Done in
// one place here rather than at walkElementInner's ~10 return points.
function walkElement(
  el: Element,
  containerRect: DOMRect,
  idGen: () => string,
  fontRefs: IRFontRef[]
): IRNode | null {
  const node = walkElementInner(el, containerRect, idGen, fontRefs)
  if (node !== null) {
    const href = extractNavHref(el)
    if (href !== null) node.linkHref = href
  }
  return node
}

// Pull the navigation target off an <a href="...">. We keep only hrefs
// that could point at another imported page frame; mailto/tel/javascript
// and pure #fragments have no frame to navigate to (same-page anchors are
// out of scope for v1). External absolute URLs are kept raw and simply
// fail to resolve in main.ts, so they cost nothing here.
function extractNavHref(el: Element): string | null {
  if (el.tagName.toLowerCase() !== 'a') return null
  const raw = el.getAttribute('href')
  if (raw === null) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.startsWith('#')) return null
  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:') ||
    lower.startsWith('javascript:') ||
    lower.startsWith('data:')
  ) {
    return null
  }
  return trimmed
}

function walkElementInner(
  el: Element,
  containerRect: DOMRect,
  idGen: () => string,
  fontRefs: IRFontRef[]
): IRNode | null {
  const tag = el.tagName.toLowerCase()

  if (tag === 'img') return buildImage(el as HTMLImageElement, containerRect, idGen)
  if (tag === 'svg') return buildSvg(el as SVGSVGElement, containerRect, idGen)

  if (SKIP_TAGS.has(tag)) return null

  if (PLACEHOLDER_TAGS.has(tag)) {
    return buildEmbedPlaceholder(el as HTMLElement, containerRect, idGen, tag, fontRefs)
  }

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

  // Form text-input controls have no DOM children but render a visible
  // placeholder string. Synthesize a Text child so the imported frame
  // shows the placeholder instead of an empty rounded rectangle.
  if (FORM_INPUT_TAGS.has(tag)) {
    return buildFormInput(el as HTMLInputElement, cs, layout, idGen, fontRefs, tag)
  }

  // Pseudo-elements get checked once, up front, so both the leaf-text
  // path and the mixed-children path can pick them up. ::before goes
  // before everything, ::after at the end.
  const beforeNode = buildPseudoElement(el, '::before', containerRect, idGen, fontRefs)
  const afterNode = buildPseudoElement(el, '::after', containerRect, idGen, fontRefs)
  const hasPseudo = beforeNode !== null || afterNode !== null

  // Pseudos with z-index < 0 sit BEHIND their parent's content in CSS.
  // We DON'T just unshift them; the boero hero has BOTH a z=-2 image
  // wrapper and a z=-1 gradient pseudo, and unshifting the pseudo
  // alone made it land BELOW the image. The final ordering pass below
  // (`reorderForZIndex`) handles every absolute child uniformly.
  const insertPseudo = (
    arr: IRNode[],
    node: IRNode | null,
    appendByDefault: boolean
  ): void => {
    if (node === null) return
    if (appendByDefault) arr.push(node)
    else arr.unshift(node)
  }

  const hasElementChildren = Array.from(el.children).some(
    (c) => !SKIP_TAGS.has(c.tagName.toLowerCase())
  )

  if (!hasElementChildren) {
    // Leaf-text path: the element has no element children, so this text
    // IS its only content. Block-level CSS always trims edges in this
    // case (there's nothing to preserve whitespace next to).
    const text = applyTextTransform(
      collapseCssWhitespace(el.textContent ?? '', cs.whiteSpace, true),
      cs.textTransform
    )
    if (text.length > 0) {
      // A leaf with text inherits a frame whenever it carries visual
      // styling (background, radius, padding) OR sports a ::before /
      // ::after that needs to sit next to the text. Otherwise we'd
      // lose either the rendered box or the pseudo dot.
      if (hasFrameWorthyStyling(cs) || hasPseudo) {
        const textLayout = rangedLayout(el, containerRect) ?? layout
        const textChild = buildText(cs, textLayout, text, idGen, fontRefs)
        const children: IRNode[] = [textChild]
        insertPseudo(children, beforeNode, false)
        insertPseudo(children, afterNode, true)
        return buildFrame(cs, layout, reorderForZIndex(children), idGen, tag)
      }
      return buildText(cs, layout, text, idGen, fontRefs)
    }
    // No text. If pseudos paint something, the element still needs a
    // frame to host them; otherwise empty box.
    if (hasPseudo) {
      const children: IRNode[] = []
      insertPseudo(children, beforeNode, false)
      insertPseudo(children, afterNode, true)
      return buildFrame(cs, layout, reorderForZIndex(children), idGen, tag)
    }
    return buildFrame(cs, layout, [], idGen, tag)
  }

  // Inline-phrase merge: when this element's children are all text +
  // inline-phrase elements (<strong>, <em>, <span>, etc.), produce a
  // SINGLE IRText with character ranges instead of fragmenting the
  // sentence into multiple frames + text nodes. Servizi.html relies on
  // this to keep "Doppia copertura: assicurativa + casa madre." in one
  // paragraph instead of splintering at every <strong>.
  //
  // We skip the merge whenever the parent has a visible ::before /
  // ::after, because the merged text would inherit the parent's rect
  // (which spans both the pseudo's cell and the text's cell on grid
  // layouts) and overlap the pseudo at the top-left. The
  // feature-list checkmark + label pattern is exactly this case.
  if (qualifiesForInlineMerge(el) && !hasPseudo) {
    const rich = buildRichInlineText(
      el,
      cs,
      layout,
      containerRect,
      idGen,
      fontRefs
    )
    if (rich !== null) {
      const richChildren: IRNode[] = [rich]
      insertPseudo(richChildren, beforeNode, false)
      insertPseudo(richChildren, afterNode, true)
      return buildFrame(cs, layout, reorderForZIndex(richChildren), idGen, tag)
    }
  }

  const children: IRNode[] = []
  insertPseudo(children, beforeNode, false)

  // Track which DOM element produced which IR node so the flex post-
  // processing below can correlate IR positions with computed styles
  // (flex-grow, margin-auto) without re-walking the DOM.
  const childOrigins: Array<{ node: IRNode; el: Element }> = []

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
      const childEl = childNode as Element
      const child = walkElement(childEl, containerRect, idGen, fontRefs)
      if (child !== null) {
        children.push(child)
        childOrigins.push({ node: child, el: childEl })
      }
    }
  }

  insertPseudo(children, afterNode, true)

  const autoLayout = extractAutoLayout(cs)

  // Flex post-processing: translate CSS flex semantics into Figma
  // child layout properties. We honour:
  //   - `flex-grow > 0`     -> child.layoutGrow = 1   (fill primary)
  //   - `align-self: stretch` or parent `align-items: stretch` with no
  //     explicit cross-axis size -> child.layoutAlign = 'STRETCH'
  //     (fill counter)
  // We deliberately do NOT inject "spacer" frames any more. Earlier
  // versions of the walker tried to translate `margin-left: auto` by
  // measuring rendered gaps and inserting transparent layoutGrow=1
  // frames, but the heuristic over-fired inside any flex container
  // whose children weren't packed at the start (e.g. the admin
  // sidebar's `.admin-nav { flex: 1 }` ate vertical space and got read
  // as "unexplained" room between siblings). Figma's native HUG and
  // STRETCH cover ~95% of these cases when the child-level properties
  // are set correctly; the rare auto-margin pattern is left to the
  // user to align manually in Figma, which is the safer trade-off.
  if (autoLayout !== null) {
    applyFlexChildLayoutProps(el as HTMLElement, autoLayout, childOrigins)
    normalizeLoneChildSpaceBetween(cs, autoLayout, childOrigins)
    injectAutoMarginSpacers(el as HTMLElement, autoLayout, children, childOrigins, idGen)
  }

  return buildFrame(cs, layout, reorderForZIndex(children), idGen, tag, autoLayout)
}

// Reorders children so absolute-positioned siblings with negative
// z-index render BELOW the in-flow content and positive-z absolute
// children render ABOVE. In-flow children keep their DOM order so
// Figma Auto Layout flow direction stays intact - the reorder only
// shuffles absolute (positioning='absolute') children which sit out
// of flow anyway. This is the boero hero stacking pattern:
//   .hero-fullpage-bg     (position: absolute; z-index: -2)
//   ::after gradient      (position: absolute; z-index: -1)
//   .container (in flow)  (z-index: 0)
// All three need to appear in that exact order so the image is
// deepest, the gradient layers on top of the image, and the content
// sits above the gradient.
function reorderForZIndex(children: IRNode[]): IRNode[] {
  if (children.length <= 1) return children
  const absoluteBelow: IRNode[] = []
  const inFlow: IRNode[] = []
  const absoluteAbove: IRNode[] = []
  for (const c of children) {
    const isAbs = c.positioning === 'absolute'
    if (isAbs && c.zIndex < 0) absoluteBelow.push(c)
    else if (isAbs && c.zIndex > 0) absoluteAbove.push(c)
    else inFlow.push(c)
  }
  // Stable sort within each absolute bucket by z-index ASC, so
  // deepest renders first (= bottom of stack in Figma's child order).
  absoluteBelow.sort((a, b) => a.zIndex - b.zIndex)
  absoluteAbove.sort((a, b) => a.zIndex - b.zIndex)
  return [...absoluteBelow, ...inFlow, ...absoluteAbove]
}

function applyFlexChildLayoutProps(
  parent: HTMLElement,
  autoLayout: IRAutoLayout,
  childOrigins: Array<{ node: IRNode; el: Element }>
): void {
  // (a) Translate flex-grow > 0 -> layoutGrow = 1.
  const win = parent.ownerDocument?.defaultView ?? window
  for (const { node, el } of childOrigins) {
    const childCs = win.getComputedStyle(el)
    const grow = parseFloat(childCs.flexGrow)
    if (Number.isFinite(grow) && grow > 0) {
      node.layoutGrow = 1
    }
  }

  // (b) Detect the `margin-left: auto` "push to the end" idiom and
  // convert the PARENT's alignment to space-between. We can't read
  // 'auto' from computed style (it's resolved to a pixel offset), so
  // we measure: when a flex container has exactly two in-flow
  // children AND a large unused gap between them, we infer that the
  // gap came from an auto margin and switch primaryAxisAlign from
  // 'min' to 'space-between'. The boero admin topbar (breadcrumb +
  // actions, or search + actions) is exactly this pattern.
  detectAutoMarginAlignment(parent, autoLayout, childOrigins)

  // (c) Detect counter-axis auto-margin centering (CSS `margin: 0 auto`
  // on a child whose cross size is capped, e.g. deltatre's `.content`
  // inside `.main`). Figma has NO per-child counter alignment anymore
  // ('MIN'/'CENTER'/'MAX' on layoutAlign are deprecated no-ops), so the
  // only lever is the PARENT's counterAxisAlign, which applies to every
  // child. We flip it to 'center' only when doing so is safe - i.e. all
  // other in-flow children already fill the counter axis (so centering
  // them is a no-op) or are themselves centered.
  detectCounterAxisAutoMarginCentering(parent, autoLayout, childOrigins)
}

// CSS `margin: 0 auto` (symmetric auto margins on the cross axis) centers
// a flex child on the counter axis. getComputedStyle resolves `auto` to
// the used pixel length it absorbed, so a centered child shows two ~equal
// counter-axis margins that, together with the child, fill the parent's
// content box.
//
// Figma can only express counter alignment at the container level
// (counterAxisAlignItems), shared by all children. So we promote the
// parent to 'center' ONLY when every in-flow child is either:
//   - centered (symmetric auto margins that fill the counter axis), or
//   - already filling the counter axis (size ~= parent content box, the
//     CSS `align-items: stretch` default) - centering a full-width child
//     is a visual no-op.
// If any child is narrower AND start-aligned (genuine left/top), we bail:
// container-level centering would wrongly shift it. We never DOWNGRADE an
// explicit center/max coming from align-items.
function detectCounterAxisAutoMarginCentering(
  parent: HTMLElement,
  autoLayout: IRAutoLayout,
  childOrigins: Array<{ node: IRNode; el: Element }>
): void {
  if (autoLayout.counterAxisAlign !== 'min') return // already center/max
  const counterHorizontal = autoLayout.direction === 'vertical'
  const win = parent.ownerDocument?.defaultView ?? window
  const parentRect = parent.getBoundingClientRect()
  const parentCs = win.getComputedStyle(parent)
  const padStart = counterHorizontal
    ? parseFloat(parentCs.paddingLeft) || 0
    : parseFloat(parentCs.paddingTop) || 0
  const padEnd = counterHorizontal
    ? parseFloat(parentCs.paddingRight) || 0
    : parseFloat(parentCs.paddingBottom) || 0
  const parentContent =
    (counterHorizontal ? parentRect.width : parentRect.height) - padStart - padEnd
  if (parentContent <= 0) return

  const EPS = 2
  let sawCentered = false
  for (const { node, el } of childOrigins) {
    if (node.positioning === 'absolute') continue
    const cs = win.getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    const size = counterHorizontal ? rect.width : rect.height
    const marginStart = counterHorizontal
      ? parseFloat(cs.marginLeft) || 0
      : parseFloat(cs.marginTop) || 0
    const marginEnd = counterHorizontal
      ? parseFloat(cs.marginRight) || 0
      : parseFloat(cs.marginBottom) || 0

    const fillsCounter = size + marginStart + marginEnd >= parentContent - EPS
    if (size >= parentContent - EPS) continue // child fills the axis: safe
    if (
      fillsCounter &&
      marginStart > EPS &&
      marginEnd > EPS &&
      Math.abs(marginStart - marginEnd) <= EPS
    ) {
      sawCentered = true
      continue // a centered child: safe
    }
    // A narrower, non-centered child: container-level centering would
    // move it incorrectly. Abort - keep the parent at 'min'.
    return
  }

  if (sawCentered) autoLayout.counterAxisAlign = 'center'
}

// Figma renders a SINGLE child under primaryAxisAlign SPACE_BETWEEN
// CENTERED, but CSS `justify-content: space-between` packs a lone flex
// item to the START. So a one-child `.page__head { display:flex;
// justify-content:space-between }` (title + subtitle wrapper) lands
// centered on the page instead of left-aligned. Downgrade to 'min'.
//
// Only `space-between` is special-cased: `space-around` / `space-evenly`
// genuinely center a lone item in BOTH CSS and Figma, so leave those.
// We read the raw computed `justify-content` because mapJustifyContent
// collapses all three space-* values into 'space-between'.
function normalizeLoneChildSpaceBetween(
  cs: CSSStyleDeclaration,
  autoLayout: IRAutoLayout,
  childOrigins: Array<{ node: IRNode; el: Element }>
): void {
  if (autoLayout.primaryAxisAlign !== 'space-between') return
  if (cs.justifyContent !== 'space-between') return
  const inFlowCount = childOrigins.filter(
    ({ node }) => node.positioning !== 'absolute'
  ).length
  if (inFlowCount < 2) {
    autoLayout.primaryAxisAlign = 'min'
  }
}

function detectAutoMarginAlignment(
  parent: HTMLElement,
  autoLayout: IRAutoLayout,
  childOrigins: Array<{ node: IRNode; el: Element }>
): void {
  // Only the in-flow children participate in flex distribution.
  // Absolutely-positioned siblings (position: absolute / fixed) are
  // taken out of flow and must not be counted - otherwise a flex column
  // with a single auto-margin child plus an absolute footer reads as 3
  // children and the auto-margin (push-to-end) idiom goes undetected.
  // This is the .login__left case: brand + manifest(margin-top:auto)
  // are the two flex children, .login__foot is position:absolute.
  const inFlow = childOrigins.filter(
    ({ node }) => node.positioning !== 'absolute'
  )
  // Only handle the two-child case. With three or more in-flow
  // children, 'space-between' would distribute everything evenly,
  // which is rarely the CSS author's intent (they'd just have used
  // justify-content: space-between explicitly).
  if (inFlow.length !== 2) return
  // Don't override an explicit non-min alignment.
  if (autoLayout.primaryAxisAlign !== 'min') return
  // Don't trigger when a child carries layoutGrow - the grow itself
  // already consumes any leftover room, so the gap math would be a
  // false positive.
  if (inFlow.some(({ node }) => (node.layoutGrow ?? 0) > 0)) return

  const horizontal = autoLayout.direction === 'horizontal'
  const win = parent.ownerDocument?.defaultView ?? window
  const parentRect = parent.getBoundingClientRect()
  const parentCs = win.getComputedStyle(parent)
  const padStart = horizontal
    ? parseFloat(parentCs.paddingLeft) || 0
    : parseFloat(parentCs.paddingTop) || 0
  const padEnd = horizontal
    ? parseFloat(parentCs.paddingRight) || 0
    : parseFloat(parentCs.paddingBottom) || 0
  const parentContent = (horizontal ? parentRect.width : parentRect.height) - padStart - padEnd
  if (parentContent <= 0) return

  const firstRect = inFlow[0].el.getBoundingClientRect()
  const secondRect = inFlow[1].el.getBoundingClientRect()
  const firstSize = horizontal ? firstRect.width : firstRect.height
  const secondSize = horizontal ? secondRect.width : secondRect.height
  const declaredGap = autoLayout.gap
  const freeSpace = parentContent - firstSize - secondSize - declaredGap
  if (freeSpace <= 40) return

  // Leftover room alone does NOT mean "push to the ends". A plain
  // `justify-content: flex-start` row (e.g. an `<li>` with a fixed-width
  // label span + a short value) also leaves a trailing gap, and must
  // stay left-aligned - converting it to space-between would shove the
  // two halves to opposite edges. The reliable signal is an ACTUAL auto
  // margin: getComputedStyle resolves a flex item's `margin: auto` to
  // the used pixel length it absorbed, so we read the gap-facing
  // margins. `margin-left:auto` on the 2nd child or `margin-right:auto`
  // on the 1st child both open the same central gap (column: top/bottom).
  const cs0 = win.getComputedStyle(inFlow[0].el)
  const cs1 = win.getComputedStyle(inFlow[1].el)
  const leadSecond = horizontal
    ? parseFloat(cs1.marginLeft) || 0
    : parseFloat(cs1.marginTop) || 0
  const trailFirst = horizontal
    ? parseFloat(cs0.marginRight) || 0
    : parseFloat(cs0.marginBottom) || 0
  const autoGap = Math.max(leadSecond, trailFirst)

  // An auto margin absorbs (nearly) all of the free space, so the used
  // margin should account for most of the leftover. A small fixed
  // margin sitting next to a large flex-start gap fails this and stays
  // 'min', which is what kills the false positives.
  if (autoGap > 40 && autoGap >= freeSpace * 0.9) {
    autoLayout.primaryAxisAlign = 'space-between'
  }
}

// Handles the `margin-*: auto` "push to the end" idiom for flex containers
// with THREE OR MORE in-flow children - the case detectAutoMarginAlignment
// deliberately skips (space-between would spread ALL items evenly, but the
// author meant "keep the left group tight, shove this child + everything
// after it to the far end"). The boero/deltatre app top bar is the canonical
// case: `<header style="display:flex"> title · sep · day · <search
// style="margin-left:auto"> · icons · button`. Figma has no per-child auto
// margin, so we insert a single transparent layoutGrow=1 SPACER frame at the
// boundary - it eats the free space exactly like the CSS auto margin and
// pushes the trailing items to the end.
//
// Precision (this is why spacer injection was previously removed): we only
// fire when ONE child's leading margin absorbed ~all of the container's free
// space, the same signal detectAutoMarginAlignment uses. A plain flex-start
// row with a trailing gap (no auto margin) reads 0 leading margins and is
// left untouched; a flex-grow child consumes the free space itself, so the
// grow guard below skips those too.
function injectAutoMarginSpacers(
  parent: HTMLElement,
  autoLayout: IRAutoLayout,
  children: IRNode[],
  childOrigins: Array<{ node: IRNode; el: Element }>,
  idGen: () => string
): void {
  const inFlow = childOrigins.filter(
    ({ node }) => node.positioning !== 'absolute'
  )
  // 2-child case is owned by detectAutoMarginAlignment (-> space-between).
  if (inFlow.length < 3) return
  // A grown child already absorbs the leftover room; no auto-margin gap.
  if (inFlow.some(({ node }) => (node.layoutGrow ?? 0) > 0)) return

  const horizontal = autoLayout.direction === 'horizontal'
  const win = parent.ownerDocument?.defaultView ?? window
  const parentRect = parent.getBoundingClientRect()
  const parentCs = win.getComputedStyle(parent)
  const padStart = horizontal
    ? parseFloat(parentCs.paddingLeft) || 0
    : parseFloat(parentCs.paddingTop) || 0
  const padEnd = horizontal
    ? parseFloat(parentCs.paddingRight) || 0
    : parseFloat(parentCs.paddingBottom) || 0
  const parentContent =
    (horizontal ? parentRect.width : parentRect.height) - padStart - padEnd
  if (parentContent <= 0) return

  let sumSizes = 0
  for (const { el } of inFlow) {
    const r = el.getBoundingClientRect()
    sumSizes += horizontal ? r.width : r.height
  }
  const totalGaps = autoLayout.gap * (inFlow.length - 1)
  const freeSpace = parentContent - sumSizes - totalGaps
  if (freeSpace <= 40) return

  // Find the boundary child whose leading auto margin swallowed ~all of the
  // free space. Check both sides of each seam: `margin-right:auto` on the
  // previous child and `margin-left:auto` on this one open the same gap.
  for (let i = 1; i < inFlow.length; i++) {
    const prevCs = win.getComputedStyle(inFlow[i - 1].el)
    const curCs = win.getComputedStyle(inFlow[i].el)
    const lead = horizontal
      ? parseFloat(curCs.marginLeft) || 0
      : parseFloat(curCs.marginTop) || 0
    const trail = horizontal
      ? parseFloat(prevCs.marginRight) || 0
      : parseFloat(prevCs.marginBottom) || 0
    const autoGap = Math.max(lead, trail)
    if (autoGap > 40 && autoGap >= freeSpace * 0.9) {
      const idx = children.indexOf(inFlow[i].node)
      if (idx >= 0) children.splice(idx, 0, makeSpacer(idGen))
      // One spacer is enough: it absorbs the whole free space and pushes
      // every later sibling to the end, matching the single-auto-margin
      // idiom. Stop so we don't double-insert on downstream seams.
      return
    }
  }
}

// A transparent, zero-size frame that fills the parent's primary axis via
// layoutGrow. Stands in for a CSS `margin: auto` gap inside Figma Auto
// Layout. sourceTag 'spacer' lets tests (and a curious user in Figma)
// recognise it.
function makeSpacer(idGen: () => string): IRFrame {
  return {
    type: 'frame',
    id: idGen(),
    layout: { x: 0, y: 0, width: 0.01, height: 0.01 },
    opacity: 1,
    hidden: false,
    blendMode: 'normal',
    zIndex: 0,
    sourceTag: 'spacer',
    fills: [],
    cornerRadius: [0, 0, 0, 0],
    children: [],
    autoLayout: null,
    shadows: [],
    stroke: null,
    clipsContent: false,
    positioning: 'auto',
    layoutGrow: 1
  }
}

// Renders a CSS generated-content pseudo-element (::before / ::after)
// as either an IRFrame (when the pseudo paints a shape: status dot,
// badge, decorative bar, etc.) or an IRText (when `content` is a glyph
// like "✓" or "→" - feature-list ticks, btn-link arrows). Covers the
// design-system idioms boero relies on; without this support the
// imported page is missing tick marks, arrows, FAQ open icons, etc.
//
// Position math: an absolutely-positioned pseudo's containing block
// is the parent's PADDING-box (when the parent is positioned). We add
// the parent padding offset; without it `inset: 0` pseudos end up
// flush against the parent's border-box edge, overflowing on the
// padding side. We also honour `transform: translate(...)` so the
// centered patterns (`top: 50%; left: 50%; transform: translate(-50%,
// -50%)`) used for FAQ cross icons and status dots land correctly.
function buildPseudoElement(
  el: Element,
  pseudo: '::before' | '::after',
  containerRect: DOMRect,
  idGen: () => string,
  fontRefs: IRFontRef[]
): IRNode | null {
  const win = el.ownerDocument?.defaultView ?? window
  const cs = win.getComputedStyle(el, pseudo)
  if (cs.content === 'none' || cs.content === 'normal' || cs.content === '') {
    return null
  }
  if (cs.display === 'none' || cs.visibility === 'hidden') return null

  // Two distinct paths: text-glyph pseudo vs shape pseudo.
  const contentText = extractPseudoText(cs.content)
  const isTextPseudo = contentText !== null && contentText.length > 0

  const w = parseFloat(cs.width) || 0
  const h = parseFloat(cs.height) || 0

  if (isTextPseudo) {
    // For text pseudos the browser sizes the box to the glyph; width
    // may report 'auto' (0 after parseFloat). Fall back to a small
    // box derived from font-size rather than dropping the glyph.
    const fontSize = parseFloat(cs.fontSize) || 12
    const tw = w > 0 ? w : fontSize
    const th = h > 0 ? h : fontSize * 1.2
    const position = resolvePseudoPosition(el, cs, containerRect)
    const fontRef = extractFontRef(cs)
    fontRefs.push(fontRef)
    return {
      type: 'text',
      id: idGen(),
      layout: { x: position.x, y: position.y, width: tw, height: th },
      opacity: extractOpacity(cs),
      hidden: false,
      blendMode: extractBlendMode(cs),
      zIndex: extractZIndex(cs),
      characters: applyTextTransform(contentText, cs.textTransform),
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

  if (w <= 0 || h <= 0) return null
  const hasFill =
    cs.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
    cs.backgroundColor !== 'transparent'
  const hasBorder =
    parseFloat(cs.borderTopWidth) > 0 ||
    parseFloat(cs.borderRightWidth) > 0 ||
    parseFloat(cs.borderBottomWidth) > 0 ||
    parseFloat(cs.borderLeftWidth) > 0
  const hasImage = cs.backgroundImage !== 'none' && cs.backgroundImage !== ''
  if (!hasFill && !hasBorder && !hasImage) return null

  const position = resolvePseudoPosition(el, cs, containerRect)
  const isAbs = cs.position === 'absolute' || cs.position === 'fixed'
  // Detect `inset: 0` (a.k.a. top:0; right:0; bottom:0; left:0) so the
  // mapper can wire the resulting Figma frame to stretch with its
  // parent. Without this, the rendered pseudo stays at the iframe-
  // measured pixel size and overflows when the parent grows in Figma.
  const stretchH =
    isAbs &&
    parseFloat(cs.left) === 0 &&
    parseFloat(cs.right) === 0
  const stretchV =
    isAbs &&
    parseFloat(cs.top) === 0 &&
    parseFloat(cs.bottom) === 0
  return {
    type: 'frame',
    id: idGen(),
    layout: { x: position.x, y: position.y, width: w, height: h },
    opacity: extractOpacity(cs),
    hidden: false,
    blendMode: extractBlendMode(cs),
    zIndex: extractZIndex(cs),
    sourceTag: pseudo === '::before' ? 'before' : 'after',
    fills: extractFills(cs),
    cornerRadius: extractCornerRadius(cs),
    children: [],
    autoLayout: null,
    shadows: extractShadows(cs),
    stroke: extractStroke(cs),
    clipsContent: false,
    positioning: isAbs ? 'absolute' : 'auto',
    constraintsStretch:
      stretchH || stretchV
        ? { horizontal: stretchH, vertical: stretchV }
        : undefined
  }
}

// Emits a styled placeholder for an iframe / embed / object. We can't
// reach into their content (cross-origin or proprietary), but the
// surrounding layout assumes the embed takes its rendered space.
//
// Google Maps embeds are special-cased: we extract the address (or
// lat/lng) from the iframe src and resolve it to a PNG via the OSM
// static-map pipeline in `map-resolver.ts`. The IRImage we emit lets
// the existing image-load step turn the URL into actual bytes, so the
// final Figma frame ships with a real rendered map instead of a gray
// box. If the resolve fails the loadImages pipeline naturally falls
// back to a missing-image placeholder.
//
// Other embeds (YouTube, Vimeo, generic) keep the soft-gray frame
// with a centred label so the designer knows what was meant to render.
function buildEmbedPlaceholder(
  el: HTMLElement,
  containerRect: DOMRect,
  idGen: () => string,
  tag: string,
  fontRefs: IRFontRef[]
): IRFrame | IRImage | null {
  const win = el.ownerDocument?.defaultView ?? window
  const cs = win.getComputedStyle(el)
  if (isHidden(cs)) return null
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null

  const layout: IRLayout = {
    x: rect.left - containerRect.left,
    y: rect.top - containerRect.top,
    width: rect.width,
    height: rect.height
  }

  const src = el.getAttribute('src') ?? ''
  if (tag === 'iframe' && isGoogleMapsUrl(src)) {
    return {
      type: 'image',
      id: idGen(),
      layout,
      opacity: extractOpacity(cs),
      hidden: false,
      blendMode: extractBlendMode(cs),
      zIndex: extractZIndex(cs),
      sourceUrl: src,
      bytes: null,
      // 'pending' triggers the resolver pass in loadImages; on failure
      // the bytes stay null and the mapper substitutes the standard
      // missing-image grey rectangle.
      loadStatus: 'pending',
      objectFit: 'cover'
    }
  }

  const label = labelForEmbed(el, tag)
  const children: IRNode[] = []
  if (label !== null) {
    // Centred label, 14 px font, dark gray on the gray placeholder.
    const labelFont: IRFontRef = {
      family: extractFontFamily(cs),
      weight: 500,
      style: 'normal'
    }
    fontRefs.push(labelFont)
    const labelHeight = 18
    const labelWidth = Math.min(label.length * 8 + 24, rect.width - 16)
    children.push({
      type: 'text',
      id: idGen(),
      layout: {
        x: layout.x + (layout.width - labelWidth) / 2,
        y: layout.y + (layout.height - labelHeight) / 2,
        width: labelWidth,
        height: labelHeight
      },
      opacity: 1,
      hidden: false,
      blendMode: 'normal',
      zIndex: 0,
      characters: label,
      fontFamily: labelFont.family,
      fontSize: 14,
      fontWeight: labelFont.weight,
      fontStyle: 'normal',
      color: { r: 0.4, g: 0.4, b: 0.45, a: 1 },
      letterSpacing: 0,
      lineHeight: 18,
      textAlign: 'center',
      textDecoration: 'none'
    })
  }

  return {
    type: 'frame',
    id: idGen(),
    layout,
    opacity: extractOpacity(cs),
    hidden: false,
    blendMode: extractBlendMode(cs),
    zIndex: extractZIndex(cs),
    sourceTag: tag,
    fills: [{ type: 'solid', color: { r: 0.93, g: 0.93, b: 0.94, a: 1 } }],
    cornerRadius: extractCornerRadius(cs),
    children,
    autoLayout: null,
    shadows: [],
    stroke: {
      color: { r: 0.78, g: 0.78, b: 0.8, a: 1 },
      width: 1,
      style: 'solid'
    },
    clipsContent: true
  }
}

// Picks a short label for an embed placeholder. Recognises Google
// Maps URLs so contatti.html reads as a real map slot; everything
// else falls back to a generic "<tag>" badge.
function labelForEmbed(el: HTMLElement, tag: string): string | null {
  const src = (el.getAttribute('src') ?? '').toLowerCase()
  if (src.includes('google.com/maps') || src.includes('maps.google.com')) {
    return '🗺  Google Maps'
  }
  if (src.includes('youtube.com') || src.includes('youtu.be')) {
    return '▶  YouTube'
  }
  if (src.includes('vimeo.com')) {
    return '▶  Vimeo'
  }
  if (tag === 'iframe') return 'Embedded content'
  return null
}

// Extracts the visible text glyph from a CSS `content` value. Computed
// `content` arrives quoted (`"✓"`, `'→ '`), occasionally concatenated
// (`"a" "b"`), and sometimes as `url(...)` / `counter(...)` / `attr(...)`
// which we don't render as text (caller falls back to shape path).
function extractPseudoText(content: string): string | null {
  if (!content) return null
  const trimmed = content.trim()
  if (trimmed === '' || trimmed === '""' || trimmed === "''") return null
  if (
    trimmed.startsWith('url(') ||
    trimmed.startsWith('counter(') ||
    trimmed.startsWith('counters(') ||
    trimmed.startsWith('attr(') ||
    trimmed.startsWith('image-set(')
  ) {
    return null
  }
  let out = ''
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(trimmed)) !== null) {
    out += (m[1] ?? m[2] ?? '').replace(/\\(.)/g, '$1')
  }
  return out.length > 0 ? out : null
}

// Picks the on-canvas position of a pseudo-element relative to the
// harness container's coordinate space. Two distinct offsets are at
// play:
//   - For NON-absolute pseudos (inline flow) we shift by the parent's
//     padding so the pseudo sits at the content-box origin where the
//     glyph would naturally land.
//   - For ABSOLUTE pseudos, the containing block is the parent's
//     padding-box, whose left edge sits at borderBox.left +
//     borderLeftWidth (NOT + paddingLeft). The earlier version added
//     paddingLeft, which shifted an `inset: 0` pseudo by the full
//     padding amount and made the login-side gradient overflow its
//     parent by ~64 px.
// `transform: translate(...)` shifts are applied on top - used by FAQ
// icons and status dots that are centred via `top:50%; left:50%;
// transform: translate(-50%, -50%)`.
function resolvePseudoPosition(
  el: Element,
  cs: CSSStyleDeclaration,
  containerRect: DOMRect
): { x: number; y: number } {
  const win = el.ownerDocument?.defaultView ?? window
  const parentRect = el.getBoundingClientRect()
  const parentCs = win.getComputedStyle(el)
  const isAbs = cs.position === 'absolute' || cs.position === 'fixed'

  if (isAbs) {
    // Containing block origin = padding-box origin = border-box origin
    // + border width. cs.left / cs.top are resolved against that.
    const borderL = parseFloat(parentCs.borderLeftWidth) || 0
    const borderT = parseFloat(parentCs.borderTopWidth) || 0
    const left = parseFloat(cs.left)
    const top = parseFloat(cs.top)
    let x = parentRect.left - containerRect.left + borderL
    let y = parentRect.top - containerRect.top + borderT
    if (Number.isFinite(left)) x += left
    if (Number.isFinite(top)) y += top
    const t = cs.transform
    if (t && t !== 'none') {
      const shift = parseTranslateFromTransform(t)
      if (shift) {
        x += shift.x
        y += shift.y
      }
    }
    return { x, y }
  }

  // In-flow pseudo: rests at the parent's content-box origin (i.e.
  // shifted by padding from the border-box edge).
  const padL = parseFloat(parentCs.paddingLeft) || 0
  const padT = parseFloat(parentCs.paddingTop) || 0
  let x = parentRect.left - containerRect.left + padL
  let y = parentRect.top - containerRect.top + padT
  const t = cs.transform
  if (t && t !== 'none') {
    const shift = parseTranslateFromTransform(t)
    if (shift) {
      x += shift.x
      y += shift.y
    }
  }
  return { x, y }
}

// Pulls the translation component out of a computed `transform` matrix.
// Computed values come as matrix(a, b, c, d, tx, ty) for 2D and
// matrix3d(...) for 3D. Percentages declared in the source CSS are
// already resolved to pixels by compute time so the matrix carries the
// final tx/ty in px. Complex rotations / scales are ignored (they
// would need full matrix composition with the position - deferred).
function parseTranslateFromTransform(
  transform: string
): { x: number; y: number } | null {
  const m2 = transform.match(/matrix\(\s*([^)]+)\)/)
  if (m2) {
    const parts = m2[1].split(',').map((s) => parseFloat(s.trim()))
    if (
      parts.length === 6 &&
      Number.isFinite(parts[4]) &&
      Number.isFinite(parts[5])
    ) {
      return { x: parts[4], y: parts[5] }
    }
  }
  const m3 = transform.match(/matrix3d\(\s*([^)]+)\)/)
  if (m3) {
    const parts = m3[1].split(',').map((s) => parseFloat(s.trim()))
    if (
      parts.length === 16 &&
      Number.isFinite(parts[12]) &&
      Number.isFinite(parts[13])
    ) {
      return { x: parts[12], y: parts[13] }
    }
  }
  return null
}

// Builds an IRFrame around a form input/textarea/select. Picks the
// best available "visible text" - the user's value, the selected
// option, or finally the placeholder - and inserts it as a Text child
// so the rendered control reads correctly in Figma instead of being
// an empty rounded box.
function buildFormInput(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  cs: CSSStyleDeclaration,
  layout: IRLayout,
  idGen: () => string,
  fontRefs: IRFontRef[],
  tag: string
): IRFrame {
  // Checkbox and radio need a completely different visual treatment
  // than text inputs - a small filled/outlined square or circle, not a
  // placeholder string. Branch before the placeholder-text path.
  if (tag === 'input') {
    const inputType = ((el as HTMLInputElement).type ?? '').toLowerCase()
    if (inputType === 'checkbox' || inputType === 'radio') {
      return buildCheckboxOrRadio(
        el as HTMLInputElement,
        cs,
        layout,
        idGen,
        inputType
      )
    }
  }

  const visibleText = readFormInputText(el)
  if (visibleText.length === 0) {
    return buildFrame(cs, layout, [], idGen, tag)
  }

  // Placeholder text usually uses a muted color via ::placeholder. We
  // approximate by reading the input's own color but bumping opacity
  // down a touch - real ::placeholder support would require a second
  // getComputedStyle(el, '::placeholder') call, which we can do later
  // if needed.
  const showingPlaceholder =
    (el as HTMLInputElement | HTMLTextAreaElement).value === '' &&
    (el as HTMLInputElement | HTMLTextAreaElement).placeholder !== undefined &&
    (el as HTMLInputElement | HTMLTextAreaElement).placeholder !== ''

  // Text fits inside the control's padding box. We approximate by
  // shrinking the rect using the computed padding-left/top - good
  // enough for the common <input> styling.
  const padL = parseFloat(cs.paddingLeft) || 0
  const padR = parseFloat(cs.paddingRight) || 0
  const padT = parseFloat(cs.paddingTop) || 0
  const padB = parseFloat(cs.paddingBottom) || 0
  const textLayout: IRLayout = {
    x: layout.x + padL,
    y: layout.y + padT,
    width: Math.max(layout.width - padL - padR, 1),
    height: Math.max(layout.height - padT - padB, 1)
  }

  const textNode = buildText(cs, textLayout, visibleText, idGen, fontRefs)
  if (showingPlaceholder) {
    // Muted placeholder look without doing a second getComputedStyle.
    textNode.opacity = textNode.opacity * 0.6
  }

  return buildFrame(cs, layout, [textNode], idGen, tag)
}

// Renders a native checkbox or radio button as a styled frame. Native
// controls in Chromium are ~13x13 (Mac/Windows) and respect
// `accent-color`. We capture the rendered size from the bounding rect
// so any custom CSS sizing on the input survives. For the checked
// state we fill the box / circle with the accent color (which is
// already rgb()-normalised by the OKLCH shim); for unchecked we leave
// a light fill + outline so the empty box still reads as a control.
//
// We deliberately skip drawing the checkmark glyph and the radio dot
// for v1 - both would need a synthetic SVG child and font-metric
// alignment. The colored fill is enough to distinguish on / off in the
// imported design, and the layout reads correctly inside its <label>.
function buildCheckboxOrRadio(
  el: HTMLInputElement,
  cs: CSSStyleDeclaration,
  layout: IRLayout,
  idGen: () => string,
  type: 'checkbox' | 'radio'
): IRFrame {
  const checked = el.checked
  const isRadio = type === 'radio'

  // accent-color falls back to the browser's default UI color when not
  // set. Either way we get an rgb()/rgba() string from computed style.
  const accentRaw = cs.accentColor ?? ''
  const accent =
    accentRaw === '' || accentRaw === 'auto'
      ? null
      : parseColor(accentRaw)
  const checkedFill: IRColor =
    accent ?? { r: 0.18, g: 0.45, b: 0.95, a: 1 } // Chromium default accent
  const uncheckedFill: IRColor = { r: 1, g: 1, b: 1, a: 1 }
  const borderColor: IRColor = checked
    ? checkedFill
    : { r: 0.55, g: 0.55, b: 0.6, a: 1 }

  // Radio = full circle. Checkbox = small radius (2 px matches the
  // Chrome / Safari default look).
  const radius = isRadio
    ? Math.max(layout.width, layout.height) / 2
    : 2

  return {
    type: 'frame',
    id: idGen(),
    layout,
    opacity: extractOpacity(cs),
    hidden: false,
    blendMode: extractBlendMode(cs),
    zIndex: extractZIndex(cs),
    sourceTag: type,
    fills: [
      {
        type: 'solid',
        color: checked ? checkedFill : uncheckedFill
      }
    ],
    cornerRadius: [radius, radius, radius, radius],
    children: [],
    autoLayout: null,
    shadows: [],
    stroke: {
      color: borderColor,
      width: 1,
      style: 'solid'
    },
    clipsContent: false
  }
}

function readFormInputText(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
): string {
  if (el.tagName.toLowerCase() === 'select') {
    const sel = el as HTMLSelectElement
    const opt = sel.options[sel.selectedIndex]
    return opt?.textContent?.trim() ?? ''
  }
  const input = el as HTMLInputElement | HTMLTextAreaElement
  if (input.value && input.value.length > 0) return input.value
  if (input.placeholder && input.placeholder.length > 0) return input.placeholder
  return ''
}

// Mirrors CSS `text-transform`. Applied at extraction time because
// Figma TextNode stores the literal characters; the browser renders
// the transform live but textContent never shows it.
function applyTextTransform(text: string, transform: string | undefined): string {
  if (!text || !transform) return text
  switch (transform) {
    case 'uppercase':
      return text.toUpperCase()
    case 'lowercase':
      return text.toLowerCase()
    case 'capitalize':
      // Capitalize the first letter of every whitespace-separated word.
      // We avoid \p{L} regex escapes because some TS targets reject them;
      // ASCII-plus-extended-Latin coverage is enough for the languages
      // boero-style mockups ship in.
      return text.replace(
        /(^|\s)([a-zA-ZÀ-ɏ])/g,
        (_m, sep: string, ch: string) => sep + ch.toUpperCase()
      )
    default:
      return text
  }
}

// Applies CSS `white-space` collapsing to a raw text string. Browsers
// render `<a>\n   Veicoli\n   </a>` as just "Veicoli" because the
// default `white-space: normal` collapses runs of whitespace; the
// browser additionally trims the EDGES of a text run when there's no
// adjacent visible neighbor on that side. We approximate that with a
// two-step pass: first collapse runs, then optionally trim edges
// based on the caller's knowledge of context (see `trimEdges`).
//
// `whiteSpace` is the parent's computed `white-space`:
//   - normal / nowrap / initial  : collapse runs of [ \t\n\r] to a
//                                  single space.
//   - pre / pre-wrap / break-spaces : preserve all whitespace.
//   - pre-line                   : collapse [ \t] only, keep newlines.
function collapseCssWhitespace(
  text: string,
  whiteSpace: string | undefined,
  trimEdges: boolean
): string {
  if (text === '') return text
  const ws = whiteSpace ?? 'normal'
  if (ws === 'pre' || ws === 'pre-wrap' || ws === 'break-spaces') {
    return text
  }
  if (ws === 'pre-line') {
    // Collapse tabs/spaces but keep newlines.
    const t = text.replace(/[\t ]+/g, ' ').replace(/^[ \t]+|[ \t]+$/gm, '')
    return trimEdges ? t.trim() : t
  }
  const collapsed = text.replace(/[\t\n\r ]+/g, ' ')
  return trimEdges ? collapsed.trim() : collapsed
}

// Whether the parent CSS context treats the gap between this text run
// and its element siblings as already-spaced (so we should trim edge
// whitespace) or as relying on the inline whitespace itself (so we
// must keep a single edge space). Flex / grid containers use `gap` to
// separate items, making leading / trailing inline whitespace redundant
// noise. Block / inline contexts rely on the whitespace.
function parentGapHandlesSpacing(display: string | undefined): boolean {
  if (!display) return false
  return (
    display === 'flex' ||
    display === 'inline-flex' ||
    display === 'grid' ||
    display === 'inline-grid'
  )
}

function buildFrame(
  cs: CSSStyleDeclaration,
  layout: IRLayout,
  children: IRNode[],
  idGen: () => string,
  tag: string,
  // Optional precomputed autoLayout. Callers that already needed the
  // flex shape upstream (to post-process spacers / flex-grow) pass it
  // in to avoid running extractAutoLayout twice. Everyone else lets us
  // compute it here.
  autoLayout?: IRAutoLayout | null
): IRFrame {
  const positioning = positioningFromCss(cs.position)
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
    autoLayout: autoLayout !== undefined ? autoLayout : extractAutoLayout(cs),
    shadows: extractShadows(cs),
    stroke: extractStroke(cs),
    clipsContent: extractClipsContent(cs),
    positioning
  }
}

// CSS position values that take an element out of normal layout flow
// (and out of an Auto Layout parent's flow in Figma).
function positioningFromCss(
  position: string | undefined
): 'auto' | 'absolute' {
  return position === 'absolute' || position === 'fixed' ? 'absolute' : 'auto'
}

// Shared out-of-flow fields for leaf nodes (img / svg) so they behave like
// frames do: an absolutely-positioned leaf must NOT participate in its
// parent's Auto Layout, and an `inset: 0` leaf should stretch to fill the
// parent. Without this an absolute decorative SVG (e.g. a full-bleed dotted
// overlay, `position:absolute; inset:0`) was walked as an in-flow child and
// occupied a full row/column in the parent's flex, collapsing a
// space-between layout into overlapping content.
function absoluteFields(cs: CSSStyleDeclaration): {
  positioning: 'auto' | 'absolute'
  constraintsStretch?: { horizontal: boolean; vertical: boolean }
} {
  const isAbs = cs.position === 'absolute' || cs.position === 'fixed'
  if (!isAbs) return { positioning: 'auto' }
  const stretchH = parseFloat(cs.left) === 0 && parseFloat(cs.right) === 0
  const stretchV = parseFloat(cs.top) === 0 && parseFloat(cs.bottom) === 0
  return {
    positioning: 'absolute',
    constraintsStretch:
      stretchH || stretchV
        ? { horizontal: stretchH, vertical: stretchV }
        : undefined
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
      // Inline-run path: trim only when the parent uses flex/grid `gap`
      // for spacing - keeping " Veicoli " in a flex nav adds redundant
      // pixels next to the gap. In block / inline contexts the edge
      // whitespace IS the visual gap, so we preserve a single space.
      characters: applyTextTransform(
        collapseCssWhitespace(
          line.text,
          parentCs.whiteSpace,
          parentGapHandlesSpacing(parentCs.display)
        ),
        parentCs.textTransform
      ),
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
    objectFit: mapObjectFit(cs.objectFit),
    ...absoluteFields(cs)
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
    svg: serializeSvgWithComputedStyles(el),
    ...absoluteFields(cs)
  }
}

// Inline-phrase tags that we flatten into the parent's text run rather
// than walking as separate IRFrames. <a> is included on purpose: in
// boero text bodies, links sit inside paragraphs and the user wants
// them as the SAME text layer (link styling is preserved as a range).
const INLINE_PHRASE_TAGS = new Set([
  'strong',
  'em',
  'b',
  'i',
  'u',
  'mark',
  'span',
  'sup',
  'sub',
  'small',
  'a',
  'cite',
  'q',
  'abbr',
  'time'
])

// Returns true when `el` is a candidate for inline-phrase merging:
// every non-text descendant is itself an inline phrase, and at least
// one descendant element exists (otherwise we'd just take the
// leaf-text path). Elements with `<br>`, images, SVG, block-level
// children, or unrecognised inline tags are rejected so we don't
// silently swallow non-textual content.
function qualifiesForInlineMerge(el: Element): boolean {
  // Merge only happens in text-flow containers (block / inline /
  // inline-block / list-item). Flex / grid / table containers give
  // each child its own visual cell - merging would glue separate nav
  // links into "CatalogoServiziAziendaContatti" or stack table cells
  // into one paragraph. The check guards against both explicit flex
  // declarations and CSS-default layout modes that fragment children.
  const win = el.ownerDocument?.defaultView ?? window
  const display = win.getComputedStyle(el).display
  if (
    display === 'flex' ||
    display === 'inline-flex' ||
    display === 'grid' ||
    display === 'inline-grid' ||
    display === 'table' ||
    display === 'inline-table' ||
    display === 'table-row' ||
    display === 'table-cell' ||
    display === 'table-header-group' ||
    display === 'table-row-group' ||
    display === 'table-column' ||
    display === 'table-column-group'
  ) {
    return false
  }

  let sawInlineElement = false
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue
    if (child.nodeType !== Node.ELEMENT_NODE) return false
    const tag = (child as Element).tagName.toLowerCase()
    if (!INLINE_PHRASE_TAGS.has(tag)) return false
    // An inline phrase whose only visible content is a ::before /
    // ::after that paints a shape (FAQ icons, decorative dots) MUST
    // be walked as a frame so we don't silently drop those pseudos.
    if (hasMeaningfulPseudo(child as Element)) return false
    sawInlineElement = true
    if (!isAllInlinePhrase(child as Element)) return false
  }
  return sawInlineElement
}

function isAllInlinePhrase(el: Element): boolean {
  if (hasMeaningfulPseudo(el)) return false
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue
    if (child.nodeType !== Node.ELEMENT_NODE) return false
    const tag = (child as Element).tagName.toLowerCase()
    if (!INLINE_PHRASE_TAGS.has(tag)) return false
    if (!isAllInlinePhrase(child as Element)) return false
  }
  return true
}

// Returns true when the element has a ::before or ::after pseudo with
// visible content (text glyph, background fill, border, or background
// image). Used to keep inline-merge from absorbing decorative spans
// like .faq-icon whose entire visual is its ::before + ::after pair.
function hasMeaningfulPseudo(el: Element): boolean {
  const win = el.ownerDocument?.defaultView ?? window
  for (const pseudo of ['::before', '::after'] as const) {
    const cs = win.getComputedStyle(el, pseudo)
    const content = cs.content
    if (content === 'none' || content === 'normal' || content === '') continue
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    // Text-content pseudo -> meaningful by definition.
    if (content !== '""' && content !== "''") return true
    // Empty content but the pseudo paints a shape - check for any
    // visible fill / border / background image.
    const hasFill =
      cs.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
      cs.backgroundColor !== 'transparent'
    const hasBorder =
      parseFloat(cs.borderTopWidth) > 0 ||
      parseFloat(cs.borderRightWidth) > 0 ||
      parseFloat(cs.borderBottomWidth) > 0 ||
      parseFloat(cs.borderLeftWidth) > 0
    const hasImage = cs.backgroundImage !== 'none' && cs.backgroundImage !== ''
    if (hasFill || hasBorder || hasImage) return true
  }
  return false
}

// Walks an inline-phrase tree and produces ONE IRText whose
// `.characters` carries the visible text and whose `.ranges`
// describe per-character style overrides for the embedded
// <strong> / <em> / <a> etc. This keeps the imported sentence as a
// single editable Figma text layer with proper bold / italic / link
// runs, the way html.to.design does it.
function buildRichInlineText(
  el: Element,
  parentCs: CSSStyleDeclaration,
  layout: IRLayout,
  containerRect: DOMRect,
  idGen: () => string,
  fontRefs: IRFontRef[]
): IRText | null {
  const win = el.ownerDocument?.defaultView ?? window
  const baseFontRef = extractFontRef(parentCs)
  const baseFontSize = parseFloat(parentCs.fontSize) || 16
  const baseColor = extractTextColor(parentCs)
  const baseDecoration = extractTextDecoration(parentCs)
  const baseWhiteSpace = parentCs.whiteSpace

  let characters = ''
  const ranges: IRTextRange[] = []
  const fontRefsCollected: IRFontRef[] = [baseFontRef]
  // Track the most recently emitted character to honour CSS whitespace
  // collapse between adjacent text nodes (so "foo " + "bar" doesn't
  // collide as "foobar").
  let lastWasSpace = true /* start-of-run is treated as already-spaced */

  function appendText(raw: string, ws: string | undefined): string {
    const collapsed = collapseCssWhitespace(raw, ws, false)
    if (collapsed === '') return ''
    let out = collapsed
    if (lastWasSpace && out.startsWith(' ')) {
      out = out.replace(/^ +/, '')
    }
    if (out === '') return ''
    lastWasSpace = out.endsWith(' ')
    return out
  }

  function visit(node: Node, currentStyle: InlineStyle): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent ?? ''
      const added = appendText(raw, baseWhiteSpace)
      if (added === '') return
      const start = characters.length
      characters += added
      const end = characters.length
      if (rangeDiffersFromBase(currentStyle, baseFontRef, baseColor, baseDecoration)) {
        ranges.push(toRange(start, end, currentStyle))
      }
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const childEl = node as Element
    const childCs = win.getComputedStyle(childEl)
    const childFontRef = extractFontRef(childCs)
    const childColor = extractTextColor(childCs)
    const childDecoration = extractTextDecoration(childCs)
    const newStyle: InlineStyle = {
      weight: childFontRef.weight,
      style: childFontRef.style,
      color: childColor,
      decoration: childDecoration
    }
    if (
      newStyle.weight !== currentStyle.weight ||
      newStyle.style !== currentStyle.style
    ) {
      // Capture the font so the mapper can load it before applying ranges.
      fontRefsCollected.push(childFontRef)
    }
    for (const c of Array.from(childEl.childNodes)) {
      visit(c, newStyle)
    }
  }

  const initial: InlineStyle = {
    weight: baseFontRef.weight,
    style: baseFontRef.style,
    color: baseColor,
    decoration: baseDecoration
  }
  for (const c of Array.from(el.childNodes)) {
    visit(c, initial)
  }
  characters = characters.replace(/ +$/, '')
  if (characters.length === 0) return null

  for (const fr of fontRefsCollected) fontRefs.push(fr)

  return {
    type: 'text',
    id: idGen(),
    layout,
    opacity: extractOpacity(parentCs),
    hidden: false,
    blendMode: extractBlendMode(parentCs),
    zIndex: extractZIndex(parentCs),
    characters: applyTextTransform(characters, parentCs.textTransform),
    fontFamily: baseFontRef.family,
    fontSize: baseFontSize,
    fontWeight: baseFontRef.weight,
    fontStyle: baseFontRef.style,
    color: baseColor,
    letterSpacing: extractLetterSpacing(parentCs),
    lineHeight: extractLineHeight(parentCs, baseFontSize),
    textAlign: extractTextAlign(parentCs),
    textDecoration: baseDecoration,
    ranges: ranges.length > 0 ? mergeAdjacentRanges(ranges) : undefined
  }
}

interface InlineStyle {
  weight: number
  style: 'normal' | 'italic' | 'oblique'
  color: IRColor
  decoration: 'none' | 'underline' | 'line-through'
}

function rangeDiffersFromBase(
  s: InlineStyle,
  baseFont: IRFontRef,
  baseColor: IRColor,
  baseDecoration: 'none' | 'underline' | 'line-through'
): boolean {
  return (
    s.weight !== baseFont.weight ||
    s.style !== baseFont.style ||
    s.decoration !== baseDecoration ||
    !colorsEqual(s.color, baseColor)
  )
}

function toRange(start: number, end: number, s: InlineStyle): IRTextRange {
  return {
    start,
    end,
    fontWeight: s.weight,
    fontStyle: s.style,
    color: s.color,
    textDecoration: s.decoration
  }
}

function colorsEqual(a: IRColor, b: IRColor): boolean {
  // Sub-channel rounding: comparing rendered colors needs to be tolerant
  // of float drift introduced by RGB/alpha math (e.g. opacity on a
  // parent + child inheritance).
  const ep = 0.005
  return (
    Math.abs(a.r - b.r) < ep &&
    Math.abs(a.g - b.g) < ep &&
    Math.abs(a.b - b.b) < ep &&
    Math.abs(a.a - b.a) < ep
  )
}

// Walks adjacent ranges and merges them when they carry identical
// style properties. This compresses, e.g., a `<strong>` containing
// two text nodes from two ranges into one.
function mergeAdjacentRanges(ranges: IRTextRange[]): IRTextRange[] {
  if (ranges.length <= 1) return ranges
  const out: IRTextRange[] = [ranges[0]]
  for (let i = 1; i < ranges.length; i++) {
    const prev = out[out.length - 1]
    const cur = ranges[i]
    if (
      prev.end === cur.start &&
      prev.fontWeight === cur.fontWeight &&
      prev.fontStyle === cur.fontStyle &&
      prev.textDecoration === cur.textDecoration &&
      colorsEqual(prev.color ?? { r: 0, g: 0, b: 0, a: 1 }, cur.color ?? { r: 0, g: 0, b: 0, a: 1 })
    ) {
      prev.end = cur.end
    } else {
      out.push(cur)
    }
  }
  return out
}

// Returns the SVG's outerHTML with every descendant's computed style
// flattened into inline presentation attributes. We have to do this
// because `figma.createNodeFromSvg` only honors inline `fill=`,
// `stroke=`, `style=...` on each SVG node - it does NOT apply external
// CSS rules (like `.chart .bar { fill: var(--chart-primary) }`). Without
// this step, a real-world dashboard SVG (`<rect class="bar">`, no inline
// fill) lands in Figma with the SVG default of solid black, which is
// exactly what the boero charts hit.
//
// We work on a clone so the live document keeps its original attribute
// shape (other walkers and downstream tools may still want to read it).
function serializeSvgWithComputedStyles(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  inlineComputedStylesPair(svg, clone)
  return clone.outerHTML
}

// SVG presentation attributes we want flattened. Keys are CSS property
// names (camelCase, as exposed by CSSStyleDeclaration); values are the
// matching SVG attribute names.
const SVG_PRESENTATION_PROPS: Array<[keyof CSSStyleDeclaration, string]> = [
  ['fill', 'fill'],
  ['fillOpacity', 'fill-opacity'],
  ['fillRule', 'fill-rule'],
  ['stroke', 'stroke'],
  ['strokeWidth', 'stroke-width'],
  ['strokeLinecap', 'stroke-linecap'],
  ['strokeLinejoin', 'stroke-linejoin'],
  ['strokeMiterlimit', 'stroke-miterlimit'],
  ['strokeDasharray', 'stroke-dasharray'],
  ['strokeDashoffset', 'stroke-dashoffset'],
  ['strokeOpacity', 'stroke-opacity'],
  ['opacity', 'opacity']
]

// Extra props applied only to text-bearing SVG nodes - font geometry
// drives the glyph paths Figma generates, so missing it makes labels
// like "GIU" wrap to "G I U" because the default font is wider than
// the page font.
const SVG_TEXT_PROPS: Array<[keyof CSSStyleDeclaration, string]> = [
  ['fontFamily', 'font-family'],
  ['fontSize', 'font-size'],
  ['fontWeight', 'font-weight'],
  ['fontStyle', 'font-style'],
  ['textAnchor', 'text-anchor'],
  ['dominantBaseline', 'dominant-baseline'],
  ['letterSpacing', 'letter-spacing']
]

const SVG_NS = 'http://www.w3.org/2000/svg'

function inlineComputedStylesPair(orig: Element, clone: Element): void {
  // namespaceURI is a string, so it works across iframe boundaries.
  // `instanceof SVGElement` does NOT - SVGElement on `window` is a
  // different constructor than `iframe.contentWindow.SVGElement`, so
  // a cross-frame instanceof check is always false and the inliner
  // silently no-ops. That bug is what kept the boero charts black
  // even after this code shipped.
  if (orig.namespaceURI === SVG_NS) {
    const win = orig.ownerDocument?.defaultView ?? window
    const cs = win.getComputedStyle(orig)
    for (const [cssProp, svgAttr] of SVG_PRESENTATION_PROPS) {
      writeIfMeaningful(clone, svgAttr, cs[cssProp] as string | undefined)
    }
    const tag = orig.tagName.toLowerCase()
    if (
      tag === 'text' ||
      tag === 'tspan' ||
      tag === 'textpath' ||
      tag === 'foreignobject'
    ) {
      for (const [cssProp, svgAttr] of SVG_TEXT_PROPS) {
        writeIfMeaningful(clone, svgAttr, cs[cssProp] as string | undefined)
      }
    }
  }
  // Walk children in parallel. The clone has identical structure to the
  // original, so element-index iteration is safe.
  const origChildren = orig.children
  const cloneChildren = clone.children
  const len = Math.min(origChildren.length, cloneChildren.length)
  for (let i = 0; i < len; i++) {
    inlineComputedStylesPair(origChildren[i], cloneChildren[i])
  }
}

function writeIfMeaningful(
  el: Element,
  attr: string,
  value: string | undefined
): void {
  if (value === undefined || value === null) return
  const trimmed = value.trim()
  if (trimmed === '') return
  // Don't write empty / placeholder fills - preserves whatever the SVG
  // already had (none on icon strokes, etc.).
  if (trimmed === 'normal' && attr !== 'font-style') return
  el.setAttribute(attr, trimmed)
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
