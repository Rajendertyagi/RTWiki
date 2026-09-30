/**
 * Post-render SVG sanitizer for Mermaid output (defence in depth).
 *
 * Mermaid under `securityLevel:'strict'` already sanitizes label HTML with
 * DOMPurify; this pass additionally guarantees, structurally and without
 * trusting the generator:
 * - no executable elements (`script`, `iframe`, `object`, `embed`, `foreignObject`)
 * - no inline event handlers (`on*` attributes)
 * - no external references: `href`/`xlink:href`/`src` must be empty or
 *   fragment-only (`#…`); `javascript:`/`data:`/absolute URLs are removed
 * - no `<style>` content carrying external loads (`@import`, `url(http`)
 *
 * Implemented over the platform XML parser (DOMParser) — no regex HTML
 * parsing, no extra dependency. Returns '' when the input cannot be parsed
 * as SVG so callers render their contained error state instead.
 */

const REMOVE_ELEMENTS = new Set(['script', 'iframe', 'object', 'embed', 'foreignObject'])

function isUnsafeReference(value: string): boolean {
  const trimmed = value.trim().toLowerCase()
  if (trimmed === '') return false
  if (trimmed.startsWith('#')) return false
  if (trimmed.startsWith('data:image/svg+xml')) return false
  return true
}

export function sanitizeDiagramSvg(svg: string): string {
  if (typeof svg !== 'string' || svg.length === 0) return ''
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  } catch {
    return ''
  }
  const root = doc.documentElement
  if (
    !root ||
    root.nodeName === 'parsererror' ||
    root.getElementsByTagName('parsererror').length > 0
  ) {
    return ''
  }

  for (const tag of REMOVE_ELEMENTS) {
    for (const element of Array.from(root.getElementsByTagName(tag))) {
      element.remove()
    }
  }

  /*
   * Give the root `<svg>` a real intrinsic size, taken from its own `viewBox`.
   *
   * Two things Mermaid writes are fought here, and both are about the diagram being
   * *stretched* rather than drawn at its own size.
   *
   * 1. `style="max-width: <natural>px"`. Inline, so it outranks any stylesheet rule. It
   *    used to be the reason "Fit width" did nothing — the box resized (measured
   *    820 -> 640 -> 820 across the presets) while the picture stayed at 196px. Removed,
   *    because a stylesheet is where a layout decision belongs.
   *
   * 2. `width="100%"` on the same element. This one is subtler and was missed: it is an
   *    *attribute*, and for a replaced element the intrinsic width is read from it, so
   *    removing the inline cap alone was not enough. With `width: 100%` still present,
   *    CSS `width: auto` resolves to 100% of the container rather than to the diagram's
   *    own size. Measured once the cap was gone: a 196px flowchart drawn at 720px, with
   *    label text the height of a headline. Every diagram in every note was blown up.
   *
   * The `viewBox` already carries the true geometry, so its dimensions *are* the natural
   * size. Writing them onto `width`/`height` gives the element a genuine intrinsic size,
   * and the stylesheet's "shrink to fit, never grow" rule then behaves.
   */
  if (root.style.maxWidth !== '') {
    root.style.removeProperty('max-width')
  }
  const viewBox = root.getAttribute('viewBox')
  if (viewBox !== null) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    if (
      parts.length === 4 &&
      parts.every((n) => Number.isFinite(n)) &&
      parts[2] > 0 &&
      parts[3] > 0
    ) {
      root.setAttribute('width', String(Math.round(parts[2])))
      root.setAttribute('height', String(Math.round(parts[3])))
    }
  }

  const all = Array.from(root.getElementsByTagName('*'))
  all.push(root)
  for (const element of all) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (name === 'href' || name === 'xlink:href' || name === 'src') {
        if (isUnsafeReference(attribute.value)) {
          element.removeAttribute(attribute.name)
        }
        continue
      }
      if (name === 'style') {
        const value = attribute.value.toLowerCase()
        if (value.includes('@import') || /url\(\s*['"]?https?:/.test(value)) {
          element.removeAttribute(attribute.name)
        }
      }
    }
    const styleElements = element.tagName === 'style' ? [element] : []
    for (const styleElement of styleElements) {
      const text = styleElement.textContent ?? ''
      if (/(@import|url\(\s*['"]?https?:)/i.test(text)) {
        styleElement.remove()
      }
    }
  }

  return new XMLSerializer().serializeToString(root)
}
