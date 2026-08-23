import { Text } from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { type UsePageTreeResult, usePageTree } from '../../../hooks/use-page-tree.js'
import { UI_TEXT } from '../../config/index.js'
import classes from './page-tree.module.css'
import { PageTreeRow } from './page-tree-row.js'

export interface MoveTarget {
  id: string
  label: string
}

export interface PageTreeControllerHooks {
  onRename: (id: string, title: string) => Promise<boolean>
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onCreateChild: (parentId: string) => void
  onMoveTo: (id: string, newParentId: string | null) => void
  onMoveRelative: (id: string, delta: number) => void
}

interface PageTreeProps {
  pages: Page[]
  activePageId: string | null
  onOpen: (id: string) => void
  hooks: PageTreeControllerHooks
}

/**
 * Accessible hierarchical page tree (WAI-ARIA tree pattern).
 *
 * Owns keyboard focus/expansion state only; the active/open page remains
 * controller-owned. Enter and mouse click open; every other interaction is
 * exploration or mutation that never navigates.
 */
export function PageTree({ pages, activePageId, onOpen, hooks }: PageTreeProps): JSX.Element {
  const tree = usePageTree({ pages, activePageId, onOpen })
  const parents = new Map(pages.map((p) => [p.id, p.parentId ?? null]))

  const moveTargets = buildMoveTargets(pages)

  const handleRenameCommit = (id: string, title: string): void => {
    void hooks.onRename(id, title).then(() => {
      tree.restoreFocusAfterChange(id)
    })
  }

  const handleDelete = (id: string): void => {
    hooks.onDelete(id)
    // Focus restoration happens after the controller refreshes the list;
    // the hook's visible-set effect keeps focus inside the tree meanwhile.
    tree.restoreFocusAfterChange(null)
  }

  const handleMoveTo = (id: string, newParentId: string): void => {
    if (!tree.isSelfOrDescendantChecker(id, newParentId)) {
      hooks.onMoveTo(id, newParentId)
    }
  }

  return (
    <div
      ref={tree.containerRef}
      role="tree"
      aria-label={UI_TEXT.dashboardTitle}
      onKeyDown={tree.handleTreeKeyDown}
      data-testid="page-tree"
    >
      {tree.rows.length === 0 ? (
        <Text size="sm" c="dimmed" ta="center">
          {UI_TEXT.emptyDescription}
        </Text>
      ) : (
        tree.rows.map((row) => (
          <PageTreeRow
            key={row.id}
            pageId={row.id}
            title={row.node.page.title}
            pageType={row.node.page.pageType}
            depth={row.depth}
            indentLevel={row.depth}
            hasChildren={row.node.children.length > 0}
            expanded={row.expanded}
            focused={tree.focusedId === row.id}
            active={activePageId === row.id}
            tabIndex={tree.focusedId === row.id ? 0 : -1}
            onOpen={() => onOpen(row.id)}
            onToggleExpand={() => tree.toggleExpand(row.id)}
            onFocusRow={() => tree.focusRow(row.id)}
            onRenameCommit={(title) => handleRenameCommit(row.id, title)}
            onRenameCancel={() => tree.restoreFocusAfterChange(row.id)}
            onCreateChild={() => hooks.onCreateChild(row.id)}
            onDuplicate={() => hooks.onDuplicate(row.id)}
            onDelete={() => handleDelete(row.id)}
            onMoveUp={() => hooks.onMoveRelative(row.id, -1)}
            onMoveDown={() => hooks.onMoveRelative(row.id, 1)}
            moveTargets={moveTargets.filter((t) => t.id !== row.id)}
            onMoveTo={(newParentId) => handleMoveTo(row.id, newParentId)}
          />
        ))
      )}
    </div>
  )
}

function buildMoveTargets(pages: Page[]): MoveTarget[] {
  return [...pages]
    .sort((a, b) => a.position - b.position)
    .map((page) => {
      const typeLabel = page.pageType === 'rich' ? UI_TEXT.richNote : UI_TEXT.htmlPage
      return {
        id: page.id,
        label: `${page.title || UI_TEXT.untitledPage} (${typeLabel})`
      }
    })
}

// Re-exported for consumers that need the expanded-state shape in tests.
export type { UsePageTreeResult }
