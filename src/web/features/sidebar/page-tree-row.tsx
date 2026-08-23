import { ActionIcon, Menu, Text, TextInput } from '@mantine/core'
import type { PageType } from '@rtwiki/shared/contracts/pages'
import { IconChevronRight, IconDots, IconFileText } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import classes from './page-tree.module.css'
import { type DropEdge, PAGE_TREE_DND_TYPE, registerRowDraggable } from './tree-dnd.js'

export interface PageTreeRowProps {
  pageId: string
  title: string
  pageType: PageType
  /** Canonical parent id of this row (drag payload identity field). */
  parentId: string | null
  hasChildren: boolean
  expanded: boolean
  focused: boolean
  active: boolean
  /** Visual indentation level (already clamped by the tree hook). */
  indentLevel: number
  tabIndex: 0 | -1
  onOpen: () => void
  onToggleExpand: () => void
  onFocusRow: () => void
  onRenameCommit: (title: string) => void
  onRenameCancel: () => void
  onCreateChild: () => void
  onDuplicate: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  /** Parent candidates for the keyboard/touch "Move to." parity menu. */
  moveTargets: Array<{ id: string; label: string }>
  onMoveTo: (newParentId: string) => void
  /** Controlled drop indicator owned by the tree container. */
  dropHint?: DropEdge | null
}

/**
 * One compact Trilium-style tree row. Purely presentational: all state and
 * behaviour arrive through props from the tree container.
 */
export function PageTreeRow(props: PageTreeRowProps): JSX.Element {
  const {
    pageId,
    title,
    pageType,
    parentId,
    hasChildren,
    expanded,
    focused,
    active,
    indentLevel,
    tabIndex,
    onOpen,
    onToggleExpand,
    onFocusRow,
    onRenameCommit,
    onRenameCancel,
    onCreateChild,
    onDuplicate,
    onDelete,
    onMoveUp,
    onMoveDown,
    moveTargets,
    onMoveTo,
    dropHint
  } = props

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)

  const displayTitle = title || UI_TEXT.untitledPage

  // Core-only drag-and-drop: this row is a draggable source. Drop handling
  // lives entirely in the tree container's single drop target.
  useEffect(() => {
    const element = rowRef.current
    if (!element) return
    return registerRowDraggable(element, {
      type: PAGE_TREE_DND_TYPE,
      pageId,
      parentId
    })
  }, [pageId, parentId])

  useEffect(() => {
    if (editing) {
      setDraft(title)
      queueMicrotask(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, title])

  const commit = (): void => {
    const trimmed = draft.trim()
    setEditing(false)
    if (!trimmed || trimmed === title) {
      onRenameCancel()
      return
    }
    onRenameCommit(trimmed)
  }

  const cancel = (): void => {
    setEditing(false)
    onRenameCancel()
  }

  const rowStyle = {
    paddingLeft: `calc(${indentLevel} * var(--rtwiki-tree-indent-step, 16px))`
  }

  const rowClassName = dropHint === 'inside' ? `${classes.row} ${classes.dropInside}` : classes.row

  return (
    <div
      className={rowClassName}
      style={rowStyle}
      data-page-id={pageId}
      data-focused={focused || undefined}
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={active}
      aria-level={indentLevel + 1}
      tabIndex={tabIndex}
      ref={(el) => {
        rowRef.current = el
        const active = document.activeElement
        const treeOwnsFocus =
          active === null ||
          active === document.body ||
          (active instanceof HTMLElement && active.closest('[role="tree"]') !== null)
        if (focused && !editing && el && active !== el && treeOwnsFocus) {
          // Roving tabindex keeps DOM focus in sync with focusedId — but
          // only while the tree already owns focus. It must never steal
          // focus from the editor or another control mid-interaction.
          el.focus({ preventScroll: false })
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'F2' && !editing) {
          event.preventDefault()
          event.stopPropagation()
          setEditing(true)
        }
        if (event.key === 'Enter' && !editing) {
          event.preventDefault()
          event.stopPropagation()
          onOpen()
        }
      }}
      onDoubleClick={() => {
        if (!editing) setEditing(true)
      }}
    >
      {dropHint === 'before' ? (
        <span aria-hidden="true" className={`${classes.insertLine} ${classes.insertLineTop}`} />
      ) : null}
      {dropHint === 'after' ? (
        <span aria-hidden="true" className={`${classes.insertLine} ${classes.insertLineBottom}`} />
      ) : null}
      <div className={classes.rowInner}>
        {hasChildren ? (
          <ActionIcon
            variant="subtle"
            size="xs"
            aria-label={expanded ? 'Collapse' : 'Expand'}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation()
              onToggleExpand()
            }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <IconChevronRight
              size={14}
              style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
            />
          </ActionIcon>
        ) : (
          <span style={{ width: 22 }} aria-hidden="true" />
        )}

        <IconFileText size={16} aria-hidden="true" />

        {editing ? (
          <TextInput
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') cancel()
              event.stopPropagation()
            }}
            aria-label="Rename page"
            className={classes.renameInput}
            size="xs"
            data-testid="page-rename-input"
          />
        ) : (
          <Text
            size="sm"
            truncate
            className={classes.label}
            onClick={() => {
              onFocusRow()
              onOpen()
            }}
            onFocus={() => onFocusRow()}
            aria-label={`Open ${displayTitle}`}
          >
            {displayTitle}
          </Text>
        )}

        {!editing ? (
          <Text size="xs" c="dimmed" visibleFrom="sm">
            {pageType === 'rich' ? UI_TEXT.richNote : UI_TEXT.htmlPage}
          </Text>
        ) : null}

        <Menu
          position="bottom-start"
          withinPortal
          closeOnEscape
          onExitTransitionEnd={() => onFocusRow()}
        >
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              size="xs"
              aria-label={`Actions for ${displayTitle}`}
              onClick={(event) => event.stopPropagation()}
            >
              <IconDots size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown className={classes.menuScroll}>
            <Menu.Item onClick={onOpen}>{UI_TEXT.openAction}</Menu.Item>
            <Menu.Item onClick={onCreateChild}>{UI_TEXT.newChildPage}</Menu.Item>
            <Menu.Item onClick={() => setEditing(true)}>{UI_TEXT.renameAction}</Menu.Item>
            <Menu.Item onClick={onDuplicate}>{UI_TEXT.duplicateAction}</Menu.Item>
            <Menu.Item color="red" onClick={onDelete}>
              {UI_TEXT.deleteAction}
            </Menu.Item>

            <Menu.Divider />
            <Menu.Label>{UI_TEXT.moveToLabel}</Menu.Label>
            <Menu.Item onClick={onMoveUp}>{UI_TEXT.moveUpLabel}</Menu.Item>
            <Menu.Item onClick={onMoveDown}>{UI_TEXT.moveDownLabel}</Menu.Item>
            <Menu.Divider />
            <Menu.Label>{UI_TEXT.moveToParentLabel}</Menu.Label>
            <div className={classes.menuScroll}>
              {moveTargets.map((target) => (
                <Menu.Item key={target.id} onClick={() => onMoveTo(target.id)}>
                  {target.label}
                </Menu.Item>
              ))}
            </div>
          </Menu.Dropdown>
        </Menu>
      </div>
    </div>
  )
}
