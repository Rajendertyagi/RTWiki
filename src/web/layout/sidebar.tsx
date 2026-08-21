import { Alert, Loader, NavLink, ScrollArea, Stack, Text } from '@mantine/core'
import { IconAlertCircle, IconFileText, IconHome } from '@tabler/icons-react'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { PageTypeBadge } from '../components/page-type-badge.js'
import { SearchInput } from '../components/search-input.js'
import { UI_TEXT } from '../config/index.js'
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
}

export function Sidebar({
  pages,
  loading,
  error,
  searchQuery,
  onSearchChange,
  selectedId,
  onSelect,
  searchInputRef
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
            {/* Home / Dashboard entry — always visible */}
            <NavLink
              label={UI_TEXT.dashboardTitle}
              leftSection={<IconHome size={16} />}
              active={selectedId === null}
              onClick={() => onSelect(null)}
              className={classes.navItem}
              aria-label={UI_TEXT.dashboardTitle}
            />

            {pages.length === 0 && !loading ? (
              <Text size="sm" c="dimmed" ta="center" className={classes.listEmpty}>
                {searchQuery.trim() ? UI_TEXT.noResults : UI_TEXT.emptyDescription}
              </Text>
            ) : (
              pages.map((page) => (
                <NavLink
                  key={page.id}
                  label={page.title || UI_TEXT.untitledPage}
                  leftSection={<IconFileText size={16} />}
                  rightSection={<PageTypeBadge pageType={page.pageType} />}
                  active={selectedId === page.id}
                  onClick={() => onSelect(page.id)}
                  className={classes.navItem}
                  aria-label={`Open ${page.title || UI_TEXT.untitledPage}`}
                />
              ))
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
