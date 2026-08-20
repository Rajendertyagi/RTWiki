import { Alert, Loader, Stack, Text, Title } from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { IconAlertCircle } from '@tabler/icons-react'
import { UI_TEXT } from '../../config/index.js'
import classes from './dashboard.module.css'
import { EmptyState } from './empty-state.js'
import { PageCard } from './page-card.js'

interface DashboardProps {
  pages: Page[]
  loading: boolean
  error: string | null
  searchQuery: string
  onOpen: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onCreateRich: () => void
  onCreateHtml: () => void
}

export function Dashboard({
  pages,
  loading,
  error,
  searchQuery,
  onOpen,
  onDuplicate,
  onDelete,
  onCreateRich,
  onCreateHtml
}: DashboardProps): JSX.Element {
  if (loading) {
    return (
      <Stack align="center" gap="sm" py="xl">
        <Loader size="sm" />
        <Text size="sm" c="dimmed">
          {UI_TEXT.loadingPages}
        </Text>
      </Stack>
    )
  }

  if (error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" title="Error">
        {error}
      </Alert>
    )
  }

  if (pages.length === 0 && !searchQuery.trim()) {
    return <EmptyState onCreateRich={onCreateRich} onCreateHtml={onCreateHtml} />
  }

  if (pages.length === 0 && searchQuery.trim()) {
    return (
      <Stack align="center" gap="sm" py="xl">
        <Text c="dimmed" ta="center">
          {UI_TEXT.noResults}
        </Text>
      </Stack>
    )
  }

  return (
    <Stack gap="md">
      <div className={classes.header}>
        <Title order={3}>{UI_TEXT.dashboardTitle}</Title>
        <Text size="sm" c="dimmed">
          {UI_TEXT.appName} — {pages.length} {pages.length === 1 ? 'page' : 'pages'}
        </Text>
      </div>

      <div className={classes.grid}>
        {pages.map((page) => (
          <PageCard
            key={page.id}
            page={page}
            onOpen={onOpen}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        ))}
      </div>
    </Stack>
  )
}
