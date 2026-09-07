import { Alert, Loader, NavLink, Stack, Text } from '@mantine/core'
import type { Page, PageType } from '@rtwiki/shared/contracts/pages'
import { IconAlertCircle, IconHome } from '@tabler/icons-react'
import { useRef, useState } from 'react'
import { SearchInput } from '../components/search-input.js'
import { UI_TEXT } from '../config/index.js'
import { PageTree } from '../features/sidebar/page-tree.js'
import classes from './sidebar.module.css'

const IMPORT_MAX_BYTES = 1_000_000

interface SidebarProps {
  pages: Page[]
  loading: boolean
  error: string | null
  searchQuery: string
  onSearchChange: (value: string) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  searchInputRef?: React.RefObject<HTMLInputElement | null>
  /** Hierarchy mutation hooks supplied by the page controller owner. */
  onRename: (id: string, title: string) => Promise<boolean>
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onCreateChild: (parentId: string) => void
  onCreateChildHtml?: (parentId: string) => void
  /** Creates a child of any type (Diagram / Mind Map entry points). */
  onCreateChildOfType?: (parentId: string, pageType: PageType) => void
  /** Creates a sibling of a page of any type, placed directly after it. */
  onCreateAfterOfType?: (pageId: string, pageType: PageType) => void
  onMoveTo: (id: string, newParentId: string | null) => void
  onMoveRelative: (id: string, delta: number) => void
  /** Positional move used by drag-and-drop (optimistic + rollback). */
  onDropMove: (id: string, newParentId: string | null, newPosition: number) => void
  /** Creates a new ROOT page from the tree's empty-space context menu. */
  onCreateRoot?: (pageType: PageType) => void
  /** Opens an HTML page's virtual source subfile in the central workspace. */
  onOpenHtmlSource: (pageId: string, field: 'html' | 'css' | 'javascript') => void
  /** Session-restoration seed for tree expansion (see usePageTree). */
  seedExpandedIds?: ReadonlySet<string>
  /** Expansion observation for session persistence. */
  onExpandedChange?: (ids: ReadonlySet<string>) => void
  /** Imports a local .md file as a new Markdown Page (filename → title). */
  onImportMarkdown: (fileName: string, source: string) => void
  /** Exports the given page (context-menu action). */
  onExportPage: (pageId: string) => void
}

export function Sidebar({
  pages,
  loading,
  error,
  searchQuery,
  onSearchChange,
  selectedId,
  onSelect,
  searchInputRef,
  onRename,
  onDuplicate,
  onDelete,
  onCreateChild,
  onCreateChildHtml,
  onCreateChildOfType,
  onCreateAfterOfType,
  onMoveTo,
  onMoveRelative,
  onDropMove,
  onCreateRoot,
  onOpenHtmlSource,
  seedExpandedIds,
  onExpandedChange,
  onImportMarkdown,
  onExportPage
}: SidebarProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const handleFileChosen = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const isMd =
      /\.(md|markdown)$/i.test(file.name) ||
      file.type === 'text/markdown' ||
      file.type === 'text/plain'
    if (!isMd) {
      setImportError(UI_TEXT.markdownImportErrorType)
      return
    }
    if (file.size > IMPORT_MAX_BYTES) {
      setImportError(UI_TEXT.markdownImportErrorSize)
      return
    }
    const reader = new FileReader()
    reader.onerror = () => setImportError(UI_TEXT.markdownImportErrorRead)
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      setImportError(null)
      onImportMarkdown(file.name, text)
    }
    reader.readAsText(file)
  }

  const requestImport = (): void => fileInputRef.current?.click()

  return (
    <div className={classes.sidebarRoot}>
      <div className={classes.searchSection}>
        <SearchInput ref={searchInputRef} value={searchQuery} onChange={onSearchChange} />
      </div>

      {/*
        Wunderbaum owns internal scrolling and needs a bounded parent, so the
        former ScrollArea wrapper is a plain flex region here.
      */}
      <div className={classes.listSection}>
        {loading ? (
          <Stack align="center" gap="sm" py="md">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              {UI_TEXT.loadingPages}
            </Text>
          </Stack>
        ) : error ? (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" title="Error">
            {error}
          </Alert>
        ) : (
          <Stack gap={2} className={classes.treeStack}>
            {/* Home / Dashboard entry — always visible, outside role=tree */}
            <NavLink
              label={UI_TEXT.rootEntryLabel}
              leftSection={<IconHome size={16} />}
              active={selectedId === null}
              onClick={() => onSelect(null)}
              className={classes.navItem}
              aria-label={UI_TEXT.rootEntryLabel}
            />

            {loading ? null : pages.length === 0 && !loading ? (
              <Text size="sm" c="dimmed" ta="center" className={classes.listEmpty}>
                {searchQuery.trim() ? UI_TEXT.noResults : UI_TEXT.emptyDescription}
              </Text>
            ) : (
              <PageTree
                pages={pages}
                activePageId={selectedId}
                onOpen={(id) => onSelect(id)}
                hooks={{
                  onRename,
                  onDuplicate,
                  onDelete,
                  onCreateChild,
                  onCreateChildHtml,
  onCreateChildOfType,
  onCreateAfterOfType,
                  onMoveTo,
                  onMoveRelative,
                  onDropMove,
                  onRequestImport: requestImport,
                  onExportPage
                }}
                onCreateRoot={onCreateRoot}
                onOpenHtmlSource={onOpenHtmlSource}
                seedExpandedIds={seedExpandedIds}
                onExpandedChange={onExpandedChange}
              />
            )}
          </Stack>
        )}
      </div>

      {importError ? (
        <Alert
          color="red"
          variant="light"
          title="Import failed"
          onClose={() => setImportError(null)}
          withCloseButton
          className={classes.importError}
        >
          {importError}
        </Alert>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        onChange={handleFileChosen}
        style={{ display: 'none' }}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  )
}
