/**
 * Preview HTML normalization.
 *
 * Runs in the browser via the standard `DOMParser` — never regular
 * expressions. It operates on a parsed copy; the stored page source is never
 * modified by this module (preview transformation is separate from
 * persistence by design).
 *
 * Removals:
 * - `script`, `iframe`, `object`, `embed`, `base` elements (entire subtrees)
 * - external stylesheet links (`link[rel~="stylesheet"]`)
 * - `meta[http-equiv]` (CSP/refresh overrides must not survive)
 * - every inline `on*` event-handler attribute on every element
 *
 * Complete documents are handled correctly: permitted head and body content
 * is extracted separately, so one `<html>` document can never end up nested
 * inside another.
 */

const REMOVED_ELEMENTS = ['script', 'iframe', 'object', 'embed', 'base'] as const

const REMOVED_SELECTORS = [
  ...REMOVED_ELEMENTS,
  'link[rel~="stylesheet"]',
  'meta[http-equiv]'
] as const

export interface NormalizedHtml {
  /** Serialized permitted head content (title, meta charset, inline styles). */
  head: string
  /** Serialized permitted body content. */
  body: string
}

export function normalizePreviewHtml(sourceHtml: string): NormalizedHtml {
  const parsed = new DOMParser().parseFromString(sourceHtml, 'text/html')

  for (const selector of REMOVED_SELECTORS) {
    for (const element of [...parsed.querySelectorAll(selector)]) {
      element.remove()
    }
  }

  // Strip every inline event-handler attribute (`on*`) from every element.
  // The parser lowercases attribute names, but the check stays
  // case-insensitive for robustness.
  for (const element of [...parsed.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name)) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  // Defensive unwrap: the HTML parser flattens stray html/head/body tags in
  // practice, but any that survive parsing as unknown elements are unwrapped
  // so a document skeleton can never nest inside the preview's own skeleton.
  const { documentElement, head, body } = parsed
  for (const element of [...parsed.querySelectorAll('html, head, body')]) {
    if (element === documentElement || element === head || element === body) {
      continue
    }
    element.replaceWith(...element.childNodes)
  }

  return {
    head: parsed.head?.innerHTML ?? '',
    body: parsed.body?.innerHTML ?? ''
  }
}
