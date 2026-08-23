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
  node: TreeNode<Page>
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
      const hasChildren = node.children.length > 0
      const expanded = hasChildren && expandedIds.has(node.page.id)
      rows.push({
        id: node.page.id,
        depth: Math.min(depth, indentClampLevels),
        node,
        expanded
      })
      if (expanded) walk(node.children, depth + 1)
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
