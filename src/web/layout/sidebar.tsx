import { Alert, Loader, NavLink, Stack, Text } from '@mantine/core'
import type { Page, PageType } from '@rtwiki/shared/contracts/pages'
import {
  classifyMarkdownImport,
  MARKDOWN_IMPORT_ACCEPT_ATTRIBUTE,
  type MarkdownImportRejection
} from '@rtwiki/shared/import/policy'
import { IconAlertCircle, IconHome } from '@tabler/icons-react'
import { useRef, useState } from 'react'
import { SearchInput } from '../components/search-input.js'
import { UI_TEXT } from '../config/index.js'
import { PageTree } from '../features/sidebar/page-tree.js'
import classes from './sidebar.module.css'

/**
 * One message per refusal reason, each naming the actual limit where there is one.
 *
 * The previous single "that file is too large" message covered two different problems —
 * a file too big to read, and a note too long to store — and named neither number. The
 * user could not tell which they had hit, or what to do about it.
 */
function markdownImportErrorText(reason: MarkdownImportRejection): string {
  switch (reason) {
    case 'not_markdown':
      return UI_TEXT.markdownImportErrorType
    case 'too_large_to_read':
      return UI_TEXT.markdownImportErrorTooLarge
    case 'too_long':
      return UI_TEXT.markdownImportErrorTooLong
    case 'read_failed':
      return UI_TEXT.markdownImportErrorRead
  }
}

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
  /**
   * Imports a local Markdown file as a new Markdown Page (filename → title).
   *
   * Returns whether the page was created. The picker shows a failure, so a rejected
   * import has to be reportable here rather than vanishing; see `handleImportMarkdown`
   * in `App.tsx`.
   */
  onImportMarkdown: (fileName: string, source: string) => Promise<boolean>
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
    // Cheap rejections first, so a 40 MB file is never handed to FileReader.
    const preRead = classifyMarkdownImport(file)
    if (preRead !== null) {
      setImportError(markdownImportErrorText(preRead))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => setImportError(markdownImportErrorText('read_failed'))
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      // The authoritative check, against the same character limit the server will
      // apply. Previously only the byte size was checked here, which is why a 150 KB
      // file could be read, posted, and refused.
      const rejection = classifyMarkdownImport(file, text)
      if (rejection !== null) {
        setImportError(markdownImportErrorText(rejection))
        return
      }
      setImportError(null)
      // The create can still be refused by the server; report that too rather than
      // leaving the user with a file that silently did not become a note.
      void onImportMarkdown(file.name, text)
        .then((created) => {
          if (!created) setImportError(UI_TEXT.markdownImportErrorCreateFailed)
        })
        .catch((err: unknown) => {
          setImportError(
            err instanceof Error ? err.message : UI_TEXT.markdownImportErrorCreateFailed
          )
        })
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
          <Stack gap={0} className={classes.treeStack}>
            {/* Home / Dashboard entry - always visible, outside role=tree.
                Styled as a tree row rather than a Mantine NavLink so its
                height, padding, icon size and selected/hover treatment are
                identical to the rows below it. Two components with two sets of
                metrics is what made the gap above the first page look wrong. */}
            <button
              type="button"
              className={classes.navItem}
              data-active={selectedId === null}
              aria-current={selectedId === null ? 'page' : undefined}
              onClick={() => onSelect(null)}
              data-testid="tree-root-entry"
            >
              <span className={classes.navExpander} aria-hidden="true" />
              <span className={classes.navIcon} aria-hidden="true">
                <IconHome size={18} />
              </span>
              <span className={classes.navLabel}>{UI_TEXT.rootEntryLabel}</span>
            </button>

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
        accept={MARKDOWN_IMPORT_ACCEPT_ATTRIBUTE}
        onChange={handleFileChosen}
        className={classes.hiddenFileInput}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  )
}
