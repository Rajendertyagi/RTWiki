/**
 * Pure Wunderbaum adapter logic: RTWiki page lists -> Wunderbaum node data,
 * plus drop-resolution math. No DOM, no React, no controller access —
 * everything here is unit-testable without a renderer.
 *
 * Corruption safety mirrors the legacy tree-model: manually edited databases
 * could contain cyclic parent chains; orphaned/cyclic nodes surface as extra
 * root rows instead of disappearing or looping forever.
 *
 * Virtual HTML source group (Feature 2): every HTML page owns a protected
 * three-row group (HTML / CSS / JavaScript) that renders immediately below
 * the parent, in that exact order, BEFORE any real child pages. Virtual rows
 * use synthetic `subfile:<pageId>:<field>` keys that can never collide with
 * page UUIDs and never map back to persisted pages.
 */

import type { Page } from '@rtwiki/shared/contracts/pages'

export type SubfileField = 'html' | 'css' | 'javascript'

export const SUBFILE_FIELDS: readonly SubfileField[] = ['html', 'css', 'javascript']

export const SUBFILE_LABELS: Record<SubfileField, string> = {
  html: 'HTML',
  css: 'CSS',
  javascript: 'JavaScript'
}

const SUBFILE_PREFIX = 'subfile:'

export function subfileKey(pageId: string, field: SubfileField): string {
  return `${SUBFILE_PREFIX}${pageId}:${field}`
}

export function parseSubfileKey(
  key: string
): { pageId: string; field: SubfileField } | null {
  if (!key.startsWith(SUBFILE_PREFIX)) return null
  const rest = key.slice(SUBFILE_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep <= 0) return null
  const field = rest.slice(sep + 1) as SubfileField
  if (!SUBFILE_FIELDS.includes(field)) return null
  return { pageId: rest.slice(0, sep), field }
}

/** Node shape the component passes to Wunderbaum (structural subset). */
export interface RtwNodeData {
  key: string
  title: string
  type: Page['pageType'] | 'subfile'
  expanded: boolean
  unselectable: true
  /** RTWiki identity payload; reaches event handlers via node.data. */
  data: {
    kind: 'page' | 'subfile'
    pageId: string
    pageType: Page['pageType'] | null
    field: SubfileField | null
  }
  children?: RtwNodeData[]
}

export interface ForestNode {
  page: Page
  children: ForestNode[]
}

/** Stable sibling order: position, then title, then id (deterministic). */
export function comparePages(a: Page, b: Page): number {
  if (a.position !== b.position) return a.position - b.position
  const byTitle = a.title.localeCompare(b.title)
  return byTitle !== 0 ? byTitle : a.id.localeCompare(b.id)
}

/**
 * Builds a forest from a flat living-page list. Nodes whose ancestors are
 * missing or cyclic are promoted to root rows so no page ever disappears.
 */
export function buildForest(pages: Page[]): ForestNode[] {
  const childrenOf = new Map<string | null, Page[]>()
  for (const page of pages) {
    const key = page.parentId ?? null
    const bucket = childrenOf.get(key)
    if (bucket) bucket.push(page)
    else childrenOf.set(key, [page])
  }
  for (const bucket of childrenOf.values()) bucket.sort(comparePages)

  const placed = new Set<string>()
  const nodes: ForestNode[] = []

  const assemble = (page: Page, guard: Set<string>): ForestNode => {
    placed.add(page.id)
    const kids = childrenOf.get(page.id) ?? []
    const childNodes: ForestNode[] = []
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
  for (const page of pages) {
    if (!placed.has(page.id)) {
      placed.add(page.id)
      nodes.push({ page, children: [] })
    }
  }
  return nodes
}

function subfileNodes(pageId: string): RtwNodeData[] {
  return SUBFILE_FIELDS.map((field) => ({
    key: subfileKey(pageId, field),
    title: SUBFILE_LABELS[field],
    type: 'subfile',
    expanded: false,
    unselectable: true,
    data: { kind: 'subfile', pageId, pageType: null, field }
  }))
}

/**
 * Converts the forest into node data. HTML pages ALWAYS carry the three
 * virtual rows as their first children (the expander must exist even with no
 * real children); expansion flags control visibility, matching Wunderbaum's
 * model. Real children follow the virtual group (Feature 2 ordering).
 */
export function forestToNodeData(
  forest: ForestNode[],
  expandedIds: ReadonlySet<string>,
  untitledLabel: string
): RtwNodeData[] {
  const walk = (nodes: ForestNode[]): RtwNodeData[] => {
    const result: RtwNodeData[] = []
    for (const node of nodes) {
      const isHtml = node.page.pageType === 'html'
      const children: RtwNodeData[] = isHtml ? subfileNodes(node.page.id) : []
      for (const child of node.children) {
        children.push(...walk([child]))
      }
      result.push({
        key: node.page.id,
        title: node.page.title || untitledLabel,
        type: node.page.pageType,
        expanded: expandedIds.has(node.page.id),
        unselectable: true,
        data: {
          kind: 'page',
          pageId: node.page.id,
          pageType: node.page.pageType,
          field: null
        },
        ...(children.length > 0 ? { children } : {})
      })
    }
    return result
  }
  return walk(forest)
}

/** Commit payload handed to the controller's positional move. */
export interface DropMove {
  pageId: string
  newParentId: string | null
  /**
   * Final index after removal among destination siblings. `null` means
   * "append at end" (MAX_SAFE_INTEGER clamps to the end server-side).
   */
  newPosition: number | null
}

/** Drop decision input: target identity + region + current page list. */
export interface DropDecisionInput {
  sourcePageId: string
  /** Resolved target: real page id, or null for empty-space/root append. */
  targetPageId: string | null
  region: 'before' | 'after' | 'over'
  pages: Page[]
  isSelfOrDescendant: (ancestorId: string, candidateId: string) => boolean
}

/**
 * Resolves a drop to a positional move using server-truth sibling math.
 *
 * Returns null when the drop must be rejected:
 * - target is a virtual subfile row (the group is untouchable),
 * - self or descendant destinations,
 * - unknown pages.
 *
 * Feature 2 guarantees: dropping "over" an HTML parent appends after the
 * virtual group (append-at-end among real children); before/after an HTML
 * parent places a real sibling page, never inside the group.
 */
export function resolveDropMove(input: DropDecisionInput): DropMove | null {
  const { sourcePageId, targetPageId, region, pages, isSelfOrDescendant } = input
  const source = pages.find((p) => p.id === sourcePageId)
  if (!source) return null

  // Empty space / root band: append as the last root.
  if (targetPageId === null) {
    return { pageId: sourcePageId, newParentId: null, newPosition: null }
  }

  const target = pages.find((p) => p.id === targetPageId)
  if (!target) return null

  if (isSelfOrDescendant(sourcePageId, targetPageId)) return null

  if (region === 'over') {
    return { pageId: sourcePageId, newParentId: targetPageId, newPosition: null }
  }

  const parentId = target.parentId ?? null
  const siblings = pages
    .filter((p) => (p.parentId ?? null) === parentId && p.id !== sourcePageId)
    .sort(comparePages)
  const index = siblings.findIndex((p) => p.id === targetPageId)
  if (index < 0) return null
  return {
    pageId: sourcePageId,
    newParentId: parentId,
    newPosition: region === 'before' ? index : index + 1
  }
}
