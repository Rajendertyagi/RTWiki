import type { Page } from '@rtwiki/shared/contracts/pages'

/**
 * React-free tree utilities for the sidebar page hierarchy.
 *
 * Pure functions only: no hooks, no DOM, no controller access. Everything
 * here is unit-testable without a renderer.
 *
 * Corruption safety: manually edited databases could contain cyclic
 * parent chains. Every traversal carries a visited set or hard iteration
 * ceiling; orphaned/cyclic nodes are surfaced as extra root rows instead of
 * disappearing or looping forever.
 */

export type PageLike = Pick<Page, 'id' | 'title' | 'pageType' | 'parentId' | 'position'>

export interface TreeNode<T extends PageLike> {
  page: T
  children: TreeNode<T>[]
}

/** Source fields exposed as virtual subfiles of an HTML page. */
export type HtmlSubfileField = 'html' | 'css' | 'javascript'

export const HTML_SUBFILE_FIELDS: readonly HtmlSubfileField[] = ['html', 'css', 'javascript']

export const HTML_SUBFILE_LABELS: Record<HtmlSubfileField, string> = {
  html: 'HTML',
  css: 'CSS',
  javascript: 'JavaScript'
}

/** Separator chosen so a subfile id can never collide with a real page id (UUIDs). */
const SUBFILE_SEPARATOR = '::'

export function htmlSubfileId(pageId: string, field: HtmlSubfileField): string {
  return `${pageId}${SUBFILE_SEPARATOR}${field}`
}

export function parseHtmlSubfileId(id: string): { pageId: string; field: HtmlSubfileField } | null {
  const index = id.lastIndexOf(SUBFILE_SEPARATOR)
  if (index <= 0) return null
  const field = id.slice(index + SUBFILE_SEPARATOR.length) as HtmlSubfileField
  if (!HTML_SUBFILE_FIELDS.includes(field)) return null
  return { pageId: id.slice(0, index), field }
}

/** Stable sibling order: position, then title, then id (deterministic tie-breaks). */
function comparePages(a: PageLike, b: PageLike): number {
  if (a.position !== b.position) return a.position - b.position
  const byTitle = a.title.localeCompare(b.title)
  return byTitle !== 0 ? byTitle : a.id.localeCompare(b.id)
}

/**
 * Builds a forest from a flat living-page list. Nodes whose ancestors are
 * missing or cyclic are promoted to root rows so no page ever disappears
 * from navigation.
 */
export function buildTree<T extends PageLike>(pages: T[]): TreeNode<T>[] {
  const childrenOf = new Map<string | null, T[]>()
  for (const page of pages) {
    const key = page.parentId ?? null
    const bucket = childrenOf.get(key)
    if (bucket) bucket.push(page)
    else childrenOf.set(key, [page])
  }
  for (const bucket of childrenOf.values()) bucket.sort(comparePages)

  const placed = new Set<string>()
  const nodes: TreeNode<T>[] = []

  const assemble = (page: T, guard: Set<string>): TreeNode<T> => {
    placed.add(page.id)
    const kids = childrenOf.get(page.id) ?? []
    const childNodes: TreeNode<T>[] = []
    for (const child of kids) {
      if (guard.has(child.id) || placed.has(child.id)) continue
      guard.add(child.id)
      childNodes.push(assemble(child, guard))
    }
    return { page, children: childNodes }
  }

  for (const root of childrenOf.get(null) ?? []) {
    if (placed.has(root.id)) continue
    nodes.push(assemble(root, new Set([root.id])))
  }

  // Orphaned/cyclic leftovers become visible root rows (never silently lost).
  for (const page of pages) {
    if (!placed.has(page.id)) {
      placed.add(page.id)
      nodes.push({ page, children: [] })
    }
  }
  return nodes
}

export interface FlatRow {
  id: string
  depth: number
  /** Null for virtual HTML subfile rows (which have no real page node). */
  node: TreeNode<Page> | null
  /** Set only on virtual subfile rows beneath an expanded HTML page. */
  subfile: { pageId: string; field: HtmlSubfileField; label: string } | null
  /** True when the row has children and is currently expanded. */
  expanded: boolean
}

/** Depth-first flattening of the expanded portion of the tree. */
export function flattenVisible(
  nodes: TreeNode<Page>[],
  expandedIds: ReadonlySet<string>,
  indentClampLevels = Number.POSITIVE_INFINITY
): FlatRow[] {
  const rows: FlatRow[] = []
  const walk = (levelNodes: TreeNode<Page>[], depth: number): void => {
    for (const node of levelNodes) {
      // HTML pages are always expandable: their virtual source subfiles live
      // behind the chevron even when no real child pages exist.
      const hasChildren = node.children.length > 0 || node.page.pageType === 'html'
      const expanded = hasChildren && expandedIds.has(node.page.id)
      rows.push({
        id: node.page.id,
        depth: Math.min(depth, indentClampLevels),
        node,
        subfile: null,
        expanded
      })
      if (expanded) {
        walk(node.children, depth + 1)
        // Virtual source subfiles trail an expanded HTML page's real
        // children, in fixed field order. They are presentation-only rows:
        // no real page backs them.
        if (node.page.pageType === 'html') {
          for (const field of HTML_SUBFILE_FIELDS) {
            rows.push({
              id: htmlSubfileId(node.page.id, field),
              depth: Math.min(depth + 1, indentClampLevels),
              node: null,
              subfile: { pageId: node.page.id, field, label: HTML_SUBFILE_LABELS[field] },
              expanded: false
            })
          }
        }
      }
    }
  }
  walk(nodes, 0)
  return rows
}

/** Parent-id lookup for ancestor walks over a flat page list. */
export function parentMap(pages: PageLike[]): Map<string, string | null> {
  const map = new Map<string, string | null>()
  for (const page of pages) map.set(page.id, page.parentId ?? null)
  return map
}

/**
 * True when `candidateId` equals `ancestorId` or lives somewhere inside its
 * subtree. Iterative with a visited set; bounded by the list length.
 */
export function isSelfOrDescendant(
  parents: ReadonlyMap<string, string | null>,
  ancestorId: string,
  candidateId: string
): boolean {
  let cursor: string | null = candidateId
  const visited = new Set<string>()
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor)
    if (cursor === ancestorId) return true
    cursor = parents.get(cursor) ?? null
  }
  return false
}

/** Case-insensitive prefix match used by type-ahead. */
export function matchesTypeAhead(label: string, buffer: string): boolean {
  return label.toLowerCase().startsWith(buffer.toLowerCase())
}

/**
 * Next visible row matching the type-ahead buffer, starting after `startRow`
 * and wrapping around. Returns -1 when nothing matches.
 */
export function nextTypeAheadMatch(
  labels: readonly string[],
  buffer: string,
  startRow: number
): number {
  if (buffer.length === 0) return -1
  const count = labels.length
  for (let step = 1; step <= count; step++) {
    const index = (startRow + step) % count
    if (matchesTypeAhead(labels[index], buffer)) return index
  }
  return -1
}
