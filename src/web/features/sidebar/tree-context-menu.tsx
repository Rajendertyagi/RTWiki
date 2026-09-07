import { Kbd, Menu } from '@mantine/core'
import {
  IconArrowDown,
  IconArrowDownLeft,
  IconArrowUp,
  IconChartArea,
  IconCode,
  IconCopy,
  IconCornerDownRight,
  IconEdit,
  IconExternalLink,
  IconFileExport,
  IconFileImport,
  IconFileText,
  IconFolder,
  IconMarkdown,
  IconSitemap,
  IconTrash
} from '@tabler/icons-react'
import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import type { PageType } from '@rtwiki/shared/contracts/pages'
import { UI_TEXT } from '../../config/index.js'
import classes from './page-tree.module.css'
import type { MoveTarget } from './page-tree.js'

export type TreeContextMenuState =
  | { kind: 'root'; x: number; y: number }
  | { kind: 'page'; pageId: string; x: number; y: number }

interface TreeContextMenuProps {
  menu: TreeContextMenuState | null
  /** Page type of the target page (page menus only); gates export options. */
  pageType?: PageType | null
  moveTargets: MoveTarget[]
  onAction: (action: string) => void
  onDismiss: () => void
  /** Opens the OS file picker for a Markdown import (root menu). */
  onRequestImport?: () => void
  /** Exports the target page (page menu). */
  onExportPage?: (pageId: string) => void
}

interface TypeItem {
  action: string
  label: string
  icon: typeof IconFileText
  /** Optional keyboard shortcut hint shown on the right (e.g. "Ctrl+Enter"). */
  shortcut?: string
}

// Platform-aware modifier label so hints read "⌘" on macOS, "Ctrl" elsewhere.
const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '')
const mod = isMac ? '⌘' : 'Ctrl'

const AFTER_ITEMS: ReadonlyArray<TypeItem> = [
  { action: 'afterRich', label: UI_TEXT.newAfterRichPage, icon: IconFileText, shortcut: `${mod}+Shift+Enter` },
  { action: 'afterHtml', label: UI_TEXT.newAfterHtmlPage, icon: IconCode },
  { action: 'afterMarkdown', label: UI_TEXT.newAfterMarkdownPage, icon: IconMarkdown },
  { action: 'afterDiagram', label: UI_TEXT.newAfterDiagramPage, icon: IconChartArea },
  { action: 'afterMindMap', label: UI_TEXT.newAfterMindMapPage, icon: IconSitemap }
]

const CHILD_ITEMS: ReadonlyArray<TypeItem> = [
  { action: 'childRich', label: UI_TEXT.newChildRichPage, icon: IconFileText, shortcut: `${mod}+Enter` },
  { action: 'childHtml', label: UI_TEXT.newChildHtmlPage, icon: IconCode },
  { action: 'childMarkdown', label: UI_TEXT.newChildMarkdownPage, icon: IconMarkdown },
  { action: 'childDiagram', label: UI_TEXT.newDiagramPage, icon: IconChartArea },
  { action: 'childMindMap', label: UI_TEXT.newMindMapPage, icon: IconSitemap }
]

// Import sources. Today only Markdown; kept as a submenu so tomorrow other
// importers (HTML, OPML, etc.) slot in without touching the menu layout.
const IMPORT_ITEMS: ReadonlyArray<TypeItem> = [
  { action: 'importMarkdown', label: UI_TEXT.importMarkdownLabel, icon: IconMarkdown }
]

/**
 * RTWiki's tree context menu, built on Mantine's `Menu` for a polished,
 * accessible, hover-driven experience that matches the rest of the app.
 *
 * Rendered with a zero-size fixed anchor at the cursor so the dropdown paints
 * at the click point and flips near viewport edges. Submenus open on hover
 * (no extra click) and every row carries a Tabler icon. Root space opens the
 * new-page submenu (any type) and Markdown import; a page row opens Open /
 * Insert-note-after / Insert-child-note submenus / Rename / Duplicate /
 * Delete plus Move and an Export submenu (Markdown pages export their source).
 */
export function TreeContextMenu({
  menu,
  pageType,
  moveTargets,
  onAction,
  onDismiss,
  onRequestImport,
  onExportPage
}: TreeContextMenuProps): JSX.Element | null {
  const [query, setQuery] = useState('')

  // Reset the move-to search whenever the menu identity changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable setter
  useEffect(() => {
    setQuery('')
  }, [menu, setQuery])

  if (menu === null) return null

  const anchorStyle: CSSProperties = {
    position: 'fixed',
    left: menu.x,
    top: menu.y,
    width: 0,
    height: 0
  }

  const trimmed = query.trim().toLowerCase()
  const filteredTargets =
    trimmed.length === 0
      ? moveTargets
      : moveTargets.filter((target) => target.label.toLowerCase().includes(trimmed))
  const visibleTargets = filteredTargets.slice(0, 50)

  const renderTypeItems = (items: ReadonlyArray<TypeItem>): JSX.Element => (
    <>
      {items.map((item) => (
        <Menu.Item
          key={item.action}
          leftSection={<item.icon size={16} />}
          rightSection={item.shortcut ? <Kbd>{item.shortcut}</Kbd> : undefined}
          onClick={() => onAction(item.action)}
        >
          {item.label}
        </Menu.Item>
      ))}
    </>
  )

  // Import is a submenu (Markdown today; other sources slot in later).
  const renderImportSubmenu = (): JSX.Element => (
    <Menu.Sub openDelay={80} closeDelay={120} safeAreaPolygon>
      <Menu.Sub.Target>
        <Menu.Sub.Item leftSection={<IconFileImport size={16} />}>{UI_TEXT.importSubmenu}</Menu.Sub.Item>
      </Menu.Sub.Target>
      <Menu.Sub.Dropdown>
        {IMPORT_ITEMS.map((item) => (
          <Menu.Item
            key={item.action}
            leftSection={<item.icon size={16} />}
            onClick={() => onRequestImport?.()}
          >
            {item.label}
          </Menu.Item>
        ))}
      </Menu.Sub.Dropdown>
    </Menu.Sub>
  )

  const isRoot = menu.kind === 'root'
  const pageId = menu.kind === 'page' ? menu.pageId : null

  // The root of the tree is not a page, so the page-only actions (open,
  // rename, duplicate, delete, move, export) have no target and are shown
  // disabled. The creation submenus and Import stay live: their actions route
  // through onCreateRoot, so "Insert child note" / "Insert note after" create
  // top-level pages and Import opens the Markdown picker — identical to a node.
  const renderPageItems = (): JSX.Element => (
    <>
      <Menu.Item
        leftSection={<IconExternalLink size={16} />}
        disabled={isRoot}
        onClick={() => onAction('open')}
      >
        {UI_TEXT.openAction}
      </Menu.Item>
      <Menu.Sub openDelay={80} closeDelay={120} safeAreaPolygon>
        <Menu.Sub.Target>
          <Menu.Sub.Item leftSection={<IconArrowDownLeft size={16} />} disabled={isRoot}>
            {UI_TEXT.newAfterSubmenu}
          </Menu.Sub.Item>
        </Menu.Sub.Target>
        <Menu.Sub.Dropdown>{renderTypeItems(AFTER_ITEMS)}</Menu.Sub.Dropdown>
      </Menu.Sub>
      <Menu.Sub openDelay={80} closeDelay={120} safeAreaPolygon>
        <Menu.Sub.Target>
          <Menu.Sub.Item leftSection={<IconCornerDownRight size={16} />}>
            {UI_TEXT.newChildSubmenu}
          </Menu.Sub.Item>
        </Menu.Sub.Target>
        <Menu.Sub.Dropdown>{renderTypeItems(CHILD_ITEMS)}</Menu.Sub.Dropdown>
      </Menu.Sub>
      <Menu.Item
        leftSection={<IconEdit size={16} />}
        rightSection={<Kbd>F2</Kbd>}
        disabled={isRoot}
        onClick={() => onAction('rename')}
      >
        {UI_TEXT.renameAction}
      </Menu.Item>
      <Menu.Item
        leftSection={<IconCopy size={16} />}
        rightSection={<Kbd>{`${mod}+D`}</Kbd>}
        disabled={isRoot}
        onClick={() => onAction('duplicate')}
      >
        {UI_TEXT.duplicateAction}
      </Menu.Item>
      <Menu.Item
        color="red"
        leftSection={<IconTrash size={16} />}
        rightSection={<Kbd>Del</Kbd>}
        disabled={isRoot}
        onClick={() => onAction('delete')}
      >
        {UI_TEXT.deleteAction}
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item
        leftSection={<IconArrowUp size={16} />}
        disabled={isRoot}
        onClick={() => onAction('moveUp')}
      >
        {UI_TEXT.moveUpLabel}
      </Menu.Item>
      <Menu.Item
        leftSection={<IconArrowDown size={16} />}
        disabled={isRoot}
        onClick={() => onAction('moveDown')}
      >
        {UI_TEXT.moveDownLabel}
      </Menu.Item>
      <Menu.Sub openDelay={80} closeDelay={120} position="right-start" safeAreaPolygon>
        <Menu.Sub.Target>
          <Menu.Sub.Item leftSection={<IconFolder size={16} />} disabled={isRoot}>
            {UI_TEXT.moveToPickerLabel}
          </Menu.Sub.Item>
        </Menu.Sub.Target>
        <Menu.Sub.Dropdown>
          <Menu.Search
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={UI_TEXT.searchPlaceholder}
          />
          {visibleTargets.length === 0 ? (
            <Menu.Item disabled>{UI_TEXT.noResults}</Menu.Item>
          ) : (
            visibleTargets.map((target) => (
              <Menu.Item
                key={target.id}
                disabled={isRoot}
                onClick={() => onAction(`moveTo:${target.id}`)}
              >
                {target.label}
              </Menu.Item>
            ))
          )}
        </Menu.Sub.Dropdown>
      </Menu.Sub>
      <Menu.Sub openDelay={80} closeDelay={120} safeAreaPolygon>
        <Menu.Sub.Target>
          <Menu.Sub.Item leftSection={<IconFileExport size={16} />} disabled={isRoot}>
            {UI_TEXT.exportSubmenu}
          </Menu.Sub.Item>
        </Menu.Sub.Target>
        <Menu.Sub.Dropdown>
          {pageType === 'markdown' && pageId !== null ? (
            <Menu.Item onClick={() => onExportPage?.(pageId)}>
              {UI_TEXT.markdownExportLabel}
            </Menu.Item>
          ) : (
            <Menu.Item disabled>{UI_TEXT.exportUnavailable}</Menu.Item>
          )}
        </Menu.Sub.Dropdown>
      </Menu.Sub>
      {renderImportSubmenu()}
    </>
  )

  return (
    <Menu
      opened
      onChange={(opened) => {
        if (!opened) onDismiss()
      }}
      position="bottom-start"
      shadow="md"
      width={220}
      withinPortal
      withArrow
      arrowPosition="side"
      classNames={{
        item: classes.treeMenuItem,
        itemSection: classes.treeMenuItemSection
      }}
    >
      <Menu.Target>
        <div style={anchorStyle} />
      </Menu.Target>
      <Menu.Dropdown data-testid="tree-context-menu" className={classes.treeMenu}>
        {renderPageItems()}
      </Menu.Dropdown>
    </Menu>
  )
}

/** Type guard for the composed moveTo:<pageId> action payloads. */
export function isMoveToAction(action: string): action is `moveTo:${string}` {
  return action.startsWith('moveTo:')
}
