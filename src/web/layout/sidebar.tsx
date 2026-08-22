import { Alert, Loader, NavLink, ScrollArea, Stack, Text } from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { IconAlertCircle, IconHome } from '@tabler/icons-react'
import { SearchInput } from '../components/search-input.js'
import { UI_TEXT } from '../config/index.js'
import { PageTree } from '../features/sidebar/page-tree.js'
import classes from './sidebar.module.css'

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
  onMoveTo: (id: string, newParentId: string | null) => void
  onMoveRelative: (id: string, delta: number) => void
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
  onMoveTo,
  onMoveRelative
}: SidebarProps): JSX.Element {
  return (
    <div className={classes.sidebarRoot}>
      <div className={classes.searchSection}>
        <SearchInput ref={searchInputRef} value={searchQuery} onChange={onSearchChange} />
      </div>

      <ScrollArea className={classes.listSection}>
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
          <Stack gap={2}>
            {/* Home / Dashboard entry — always visible, outside role=tree */}
            <NavLink
              label={UI_TEXT.dashboardTitle}
              leftSection={<IconHome size={16} />}
              active={selectedId === null}
              onClick={() => onSelect(null)}
              className={classes.navItem}
              aria-label={UI_TEXT.dashboardTitle}
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
                  onMoveTo,
                  onMoveRelative
                }}
              />
            )}
          </Stack>
        )}
      </ScrollArea>

      <Text size="xs" c="dimmed" ta="center" className={classes.hierarchyNote}>
        {UI_TEXT.hierarchyFutureNote}
      </Text>
    </div>
  )
}
