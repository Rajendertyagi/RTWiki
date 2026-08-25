/**
 * Internal page links ("wiki links").
 *
 * Representation decision: an ordinary BlockNote link mark whose href is
 * `rtwiki://page/<pageId>`. The href is a plain string attribute, so the
 * installed editor preserves it verbatim through every save/load round-trip,
 * through paste, and through external HTML export (where it degrades to a
 * harmless custom-scheme anchor). The stored identity is the page ID, so
 * renaming a page never breaks a link, and a deleted target is detectable by
 * simple ID lookup — a recreated page with the same title can never silently
 * reconnect an old link because IDs are UUIDs minted at creation.
 */

export const RTWIKI_LINK_PREFIX = 'rtwiki://page/' as const

/** Extracts the target page ID from an internal link href, or null. */
export function parseInternalLinkHref(href: string): string | null {
  if (!href.startsWith(RTWIKI_LINK_PREFIX)) return null
  const id = href.slice(RTWIKI_LINK_PREFIX.length)
  // Loose UUID-shape guard: enough to reject prose that merely starts with
  // the scheme, not enough to reject any future ID format.
  return id.length >= 8 ? id : null
}

export function buildInternalLinkHref(pageId: string): string {
  return `${RTWIKI_LINK_PREFIX}${pageId}`
}

interface LinkBlockLike {
  type?: string
  href?: string
  content?: unknown[]
  children?: unknown[]
}

function collectLinks(blocks: unknown[], out: Set<string>): void {
  for (const raw of blocks) {
    if (!raw || typeof raw !== 'object') continue
    const block = raw as LinkBlockLike
    if (block.type === 'link' && typeof block.href === 'string') {
      const id = parseInternalLinkHref(block.href)
      if (id !== null) out.add(id)
    }
    if (Array.isArray(block.content)) collectLinks(block.content, out)
    if (Array.isArray(block.children)) collectLinks(block.children, out)
  }
}

/**
 * Extracts every internal link target from a canonical Rich Note document.
 *
 * Only real link marks are indexed — plain text resembling a link, external
 * URLs, and unsupported-block preservation payloads (which are plain strings
 * inside code blocks, never link marks) can never produce entries. Total on
 * malformed input: returns an empty set.
 */
export function extractPageLinks(storedContent: string): string[] {
  let data: unknown
  try {
    data = JSON.parse(storedContent)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const out = new Set<string>()
  collectLinks(data, out)
  return [...out]
}

interface ContextBlockLike {
  type?: string
  href?: string
  text?: string
  content?: unknown[]
  children?: unknown[]
}

/**
 * Finds the first occurrence of a link to `targetId` and returns a short
 * readable snippet of surrounding inline text (the link's own words plus
 * neighbouring sentences). Used for backlink context display; never surfaces
 * raw JSON. Returns null when the document does not link the target.
 */
export function findLinkContext(storedContent: string, targetId: string): string | null {
  let data: unknown
  try {
    data = JSON.parse(storedContent)
  } catch {
    return null
  }
  if (!Array.isArray(data)) return null

  let result: string | null = null
  const visit = (items: unknown[]): void => {
    if (result !== null) return
    let buffer = ''
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue
      const node = raw as ContextBlockLike
      if (node.type === 'link' && typeof node.href === 'string') {
        const id = parseInternalLinkHref(node.href)
        if (id === targetId) {
          let linkedText = ''
          if (Array.isArray(node.content)) {
            for (const inner of node.content as ContextBlockLike[]) {
              if (typeof inner?.text === 'string') linkedText += inner.text
            }
          }
          result = `${buffer}${linkedText}`.trim()
          return
        }
      }
      if (typeof node.text === 'string') {
        buffer = `${buffer}${node.text} `.slice(-120)
      }
      if (Array.isArray(node.content)) visit(node.content)
      if (result !== null) return
    }
  }

  const walkBlocks = (blocks: unknown[]): void => {
    if (result !== null) return
    for (const raw of blocks) {
      if (!raw || typeof raw !== 'object') continue
      const block = raw as ContextBlockLike
      if (Array.isArray(block.content)) visit(block.content)
      if (result !== null) return
      if (Array.isArray(block.children)) walkBlocks(block.children)
      if (result !== null) return
    }
  }

  walkBlocks(data)
  // Read through a widened local: TypeScript's control flow cannot observe
  // assignments made inside the nested visitors above.
  const found = result as string | null
  return found !== null && found.length > 0 ? found : null
}
