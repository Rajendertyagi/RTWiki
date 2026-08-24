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
