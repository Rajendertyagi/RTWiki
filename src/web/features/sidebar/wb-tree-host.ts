/**
 * Wunderbaum tree host — the imperative mount layer between React and the
 * Wunderbaum instance (tree foundation, ADR-008).
 *
 * Division of responsibility:
 * - `wb-adapter.ts` holds ALL pure logic (model building, subfile keys,
 *   drop resolution) and is unit-tested without a DOM.
 * - This module owns exactly one Wunderbaum instance per mount, wires its
 *   event callbacks into RTWiki's controller callbacks, and enforces the
 *   tree interaction contract:
 *     • the disclosure control expands/collapses only — never opens a page,
 *     • click on row/icon/title routes through RTWiki's navigation flow,
 *     • virtual subfile rows open their source workspace and are inert for
 *       drag, selection, and lifecycle actions,
 *     • context menu requests are delegated to RTWiki's portalled menu (the
 *       browser native menu is suppressed on every row region),
 *     • drop destinations are resolved by the pure adapter, which rejects
 *       self/descendant/virtual targets before indicators are offered.
 *
 * React strict-mode safety: mount -> destroy -> mount re-creates the
 * instance; Wunderbaum's `destroy()` removes its delegated listeners and
 * viewport markup, so no duplicate listeners survive a double-mount.
 *
 * Only `Wunderbaum` itself is imported from the package: the bundled public
 * d.ts exports the class (plus runtime helpers) but not the internal event
 * payload types, so structural local types are used at the boundaries.
 */

import type { Page } from '@rtwiki/shared/contracts/pages'
import { Wunderbaum } from 'wunderbaum'
import {
  buildForest,
  type DropMove,
  forestToNodeData,
  parseSubfileKey,
  resolveDropMove,
  type SubfileField
} from './wb-adapter.js'

export type { DropMove, SubfileField } from './wb-adapter.js'
export { parseSubfileKey, subfileKey } from './wb-adapter.js'

export interface PageTreeHostCallbacks {
  /** Opens a persisted page through RTWiki's controller/tab flow. */
  onOpenPage: (pageId: string) => void
  /** Opens a virtual HTML/CSS/JS source workspace. */
  onOpenSubfile: (pageId: string, field: SubfileField) => void
  /** Commits a positional move resolved by the pure adapter. */
  onDropMove: (move: DropMove) => void
  /** Requests RTWiki's portalled context menu at pointer coordinates. */
  onContextMenu: (
    payload:
      | { kind: 'page'; pageId: string; x: number; y: number }
      | { kind: 'root'; x: number; y: number }
  ) => void
  /** Requests an inline rename for a page row (context-menu path). */
  onRenameRequest: (pageId: string) => void
  /** Expansion observation for session persistence. */
  onExpandedChange?: (ids: ReadonlySet<string>) => void
}

export interface PageTreeHostOptions {
  pages: Page[]
  activePageId: string | null
  untitledLabel: string
  callbacks: PageTreeHostCallbacks
  /** Self-or-descendant check from the controller's parent map. */
  isSelfOrDescendant: (ancestorId: string, candidateId: string) => boolean
}

const ROW_HEIGHT_PX = 32

/** Minimal structural shape of a Wunderbaum node used by the host. */
interface WbNodeLike {
  key: string
  parent: WbNodeLike | null
  children: WbNodeLike[] | null
  getLevel(): number
  isActive(): boolean
  isExpanded(): boolean
  setActive(flag: boolean, options?: { noEvents?: boolean; focusTree?: boolean }): unknown
  setExpanded(flag: boolean, options?: { noEvents?: boolean }): unknown
  startEditTitle(): unknown
}

export class PageTreeHost {
  private tree: Wunderbaum | null = null
  private options: PageTreeHostOptions | null = null
  private lastExpandedKey: string | null = null
  private contextMenuDismiss: (() => void) | null = null
  /** Latest pages list, mirrored for drop resolution at event time. */
  private pagesRef: Page[] = []

  /** Creates and mounts the instance (exactly one per element lifetime). */
  mount(element: HTMLElement, options: PageTreeHostOptions): void {
    if (this.tree) throw new Error('PageTreeHost is already mounted')
    this.options = options
    this.pagesRef = options.pages
    this.tree = this.createInstance(element, options)
  }

  destroy(): void {
    this.contextMenuDismiss?.()
    this.contextMenuDismiss = null
    this.tree?.destroy()
    this.tree = null
    this.options = null
    this.lastExpandedKey = null
  }

  getInstance(): Wunderbaum | null {
    return this.tree
  }

  /** Reloads data while preserving expansion; re-applies active selection. */
  reload(options: PageTreeHostOptions): void {
    const tree = this.tree
    if (!tree) return
    this.options = options
    this.pagesRef = options.pages
    const expanded = this.collectExpanded()
    tree.load({
      children: forestToNodeData(
        buildForest(options.pages),
        expanded,
        options.untitledLabel
      ) as never
    })
    this.applyActive(options.activePageId)
    this.observeExpansion(true)
  }

  applyActive(pageId: string | null): void {
    const tree = this.tree
    if (!tree) return
    const current = tree.getActiveNode()
    if (pageId === null) {
      current?.setActive(false, { noEvents: true })
      return
    }
    if (current?.key === pageId) return
    tree.findKey(pageId)?.setActive(true, { noEvents: true })
  }

  /** Applies a session-restoration expansion seed (once per identity). */
  applySeed(ids: ReadonlySet<string>): void {
    const tree = this.tree
    if (!tree || ids.size === 0) return
    tree.runWithDeferredUpdate(() => {
      for (const id of ids) {
        tree.findKey(id)?.setExpanded(true, { noEvents: true })
      }
    })
    this.observeExpansion(true)
  }

  /** Force-expands a page row (used after creating a child beneath it). */
  expandPage(pageId: string): void {
    this.tree?.findKey(pageId)?.setExpanded(true)
  }

  /** Restores tree focus after structural changes; never opens a page. */
  restoreFocus(preferredId: string | null): void {
    const tree = this.tree
    if (!tree) return
    const target =
      (preferredId !== null ? tree.findKey(preferredId) : null) ??
      tree.getActiveNode() ??
      tree.root.children?.[0] ??
      null
    target?.setActive(true, { noEvents: true, focusTree: true })
  }

  // -------------------------------------------------------------------------

  private collectExpanded(): ReadonlySet<string> {
    const set = new Set<string>()
    const tree = this.tree
    if (!tree) return set
    for (const node of tree) {
      if (node.isExpanded() && parseSubfileKey(node.key) === null) set.add(node.key)
    }
    return set
  }

  private observeExpansion(force = false): void {
    const ids = this.collectExpanded()
    const key = [...ids].sort().join('|')
    if (!force && key === this.lastExpandedKey) return
    this.lastExpandedKey = key
    this.options?.callbacks.onExpandedChange?.(ids)
  }

  private asNode(value: unknown): WbNodeLike | null {
    return (value ?? null) as WbNodeLike | null
  }

  private createInstance(element: HTMLElement, options: PageTreeHostOptions): Wunderbaum {
    const host = this
    // Constructor options are structurally typed against the bundled public
    // d.ts; this local shape keeps the RTWiki-specific callbacks honest
    // without importing the package's internal types.
    const tree = new Wunderbaum({
      element: element as HTMLDivElement,
      id: 'rtwiki-page-tree',
      header: null,
      rowHeightPx: ROW_HEIGHT_PX,
      quicksearch: true,
      selectMode: 'single',
      checkbox: false,
      autoCollapse: false,
      minExpandLevel: 0,
      // RTWiki ships its own inline icons via the render hook; the bootstrap
      // icon font is never loaded, so expander/doc glyphs become inert
      // placeholders styled in the CSS module.
      iconMap: {
        error: 'rtw-icon-slot',
        loading: 'rtw-icon-slot',
        noData: 'rtw-icon-slot',
        expanderCollapsed: 'rtw-expander rtw-collapsed',
        expanderExpanded: 'rtw-expander rtw-expanded',
        expanderLazy: 'rtw-expander rtw-collapsed',
        checkChecked: 'rtw-icon-slot',
        checkUnchecked: 'rtw-icon-slot',
        checkUnknown: 'rtw-icon-slot',
        radioChecked: 'rtw-icon-slot',
        radioUnchecked: 'rtw-icon-slot',
        radioUnknown: 'rtw-icon-slot',
        folder: 'rtw-icon-slot',
        folderOpen: 'rtw-icon-slot',
        folderLazy: 'rtw-icon-slot',
        doc: 'rtw-icon-slot',
        colSortable: 'rtw-icon-slot',
        colSortAsc: 'rtw-icon-slot',
        colSortDesc: 'rtw-icon-slot',
        colFilter: 'rtw-icon-slot',
        colFilterActive: 'rtw-icon-slot',
        colMenu: 'rtw-icon-slot'
      } as never,
      types: {
        rich: { classes: 'rtw-type-rich' },
        html: { classes: 'rtw-type-html' },
        diagram: { classes: 'rtw-type-diagram' },
        mindmap: { classes: 'rtw-type-mindmap' },
        subfile: { classes: 'rtw-type-subfile' }
      },
      edit: {
        trigger: ['F2'],
        minlength: 1,
        maxlength: 200,
        trim: true,
        select: true,
        beforeEdit: (e) => parseSubfileKey(e.node.key) === null,
        apply: (e) => {
          const subfile = parseSubfileKey(e.node.key)
          if (subfile) return false
          const title = String(e.inputElem?.value ?? '').trim()
          if (title.length > 0 && title !== e.node.title) {
            this.options?.callbacks.onRenameRequest(e.node.key)
          }
          return undefined
        }
      },
      dnd: {
        effectAllowed: 'move',
        dropEffectDefault: 'move',
        guessDropEffect: false,
        preventRecursion: true,
        preventVoidMoves: true,
        scroll: true,
        dragStart: (e) => parseSubfileKey(e.node.key) === null,
        dragEnter: (e) => {
          // Virtual rows offer NO destinations; neither does a descendant.
          if (parseSubfileKey(e.node.key) !== null) return false
          if (this.options?.isSelfOrDescendant(e.sourceNode.key, e.node.key)) {
            return false
          }
          return ['before', 'after', 'over']
        },
        drop: (e) => {
          const targetKey = e.node.key
          const move = resolveDropMove({
            sourcePageId: e.sourceNode.key,
            targetPageId: parseSubfileKey(targetKey) !== null ? null : targetKey,
            region: e.region,
            pages: this.pagesRef,
            isSelfOrDescendant: (a, c) => this.options?.isSelfOrDescendant(a, c) ?? true
          })
          if (move) this.options?.callbacks.onDropMove(move)
        }
      },
      click: (e) => {
        const node = host.asNode(e.node)
        if (!node) return undefined
        // The disclosure control toggles expansion through Wunderbaum's
        // default handler — never open the page from the expander region.
        if ((e.info as { region?: string }).region === 'expander') return undefined
        const subfile = parseSubfileKey(node.key)
        if (subfile) {
          this.options?.callbacks.onOpenSubfile(subfile.pageId, subfile.field)
        } else {
          this.options?.callbacks.onOpenPage(node.key)
        }
        // RTWiki owns navigation; suppress Wunderbaum's activate default.
        return false
      },
      keydown: (e) => {
        const node = this.asNode(e.node)
        if (e.event.key === 'Enter' && node) {
          e.event.preventDefault()
          const subfile = parseSubfileKey(node.key)
          if (subfile) {
            this.options?.callbacks.onOpenSubfile(subfile.pageId, subfile.field)
          } else {
            this.options?.callbacks.onOpenPage(node.key)
          }
          return false
        }
        return undefined
      },
      expand: () => this.observeExpansion(),
      render: (e) => {
        const node = this.asNode(e.node)
        const nodeElem = e.nodeElem
        const row = nodeElem.closest('div.wb-row') as HTMLElement | null
        if (!node || !row) return
        const subfile = parseSubfileKey(node.key)
        if (subfile) {
          row.setAttribute('role', 'treeitem')
          row.setAttribute('data-subfile-id', `${subfile.pageId}::${subfile.field}`)
          row.setAttribute('data-page-id', subfile.pageId)
          row.setAttribute('aria-level', String(node.getLevel()))
          row.setAttribute('aria-selected', 'false')
          row.removeAttribute('aria-expanded')
        } else {
          row.setAttribute('role', 'treeitem')
          row.setAttribute('data-page-id', node.key)
          row.setAttribute('aria-level', String(node.getLevel()))
          row.setAttribute('aria-selected', String(node.isActive()))
          if (node.children !== null && node.children.length > 0) {
            row.setAttribute('aria-expanded', String(node.isExpanded()))
          } else {
            row.removeAttribute('aria-expanded')
          }
        }
        if (e.isNew) {
          const titleSpan = nodeElem.querySelector('span.wb-title')
          const icon = document.createElement('i')
          icon.className = 'rtw-page-icon'
          icon.setAttribute('aria-hidden', 'true')
          if (titleSpan) nodeElem.insertBefore(icon, titleSpan)
          if (subfile === null) {
            const action = document.createElement('button')
            action.type = 'button'
            action.className = 'rtw-row-action'
            action.setAttribute('aria-label', `Actions for ${node.key}`)
            action.setAttribute('data-testid', 'tree-row-action')
            action.addEventListener('click', (ev) => {
              ev.stopPropagation()
              ev.preventDefault()
              const rect = action.getBoundingClientRect()
              this.options?.callbacks.onContextMenu({
                kind: 'page',
                pageId: node.key,
                x: rect.left,
                y: rect.bottom + 2
              })
            })
            nodeElem.appendChild(action)
          }
        }
      },
      init: () => {
        this.applyActive(this.options?.activePageId ?? null)
        this.observeExpansion(true)
      }
    })

    tree.load({
      children: forestToNodeData(
        buildForest(options.pages),
        new Set<string>(),
        options.untitledLabel
      ) as never
    })

    // One container-level context menu delegation: every row region opens
    // RTWiki's menu (never the native one); blank space opens the root menu.
    const onContextMenu = (ev: MouseEvent): void => {
      ev.preventDefault()
      const node = Wunderbaum.getNode(ev)
      const key = node?.key ?? null
      if (key === null || parseSubfileKey(key) !== null) {
        options.callbacks.onContextMenu({ kind: 'root', x: ev.clientX, y: ev.clientY })
        return
      }
      options.callbacks.onContextMenu({
        kind: 'page',
        pageId: key,
        x: ev.clientX,
        y: ev.clientY
      })
    }
    element.addEventListener('contextmenu', onContextMenu)
    this.contextMenuDismiss = () => element.removeEventListener('contextmenu', onContextMenu)

    return tree
  }
}
