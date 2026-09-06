import { Alert, Button, Group, Loader, Stack, Text, Title } from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { IconAlertCircle, IconFileImport } from '@tabler/icons-react'
import { useRef, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import classes from './dashboard.module.css'
import { EmptyState } from './empty-state.js'
import { PageCard } from './page-card.js'

const IMPORT_MAX_BYTES = 1_000_000

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
  /** Imports a local .md file as a new Markdown Page (filename → title). */
  onImportMarkdown: (fileName: string, source: string) => void
}

export function Dashboard(props: DashboardProps): JSX.Element {
  return (
    <div className={classes.scrollRegion} data-testid="dashboard-scroll">
      <DashboardContent {...props} />
    </div>
  )
}

function DashboardContent({
  pages,
  loading,
  error,
  searchQuery,
  onOpen,
  onDuplicate,
  onDelete,
  onCreateRich,
  onCreateHtml,
  onImportMarkdown
}: DashboardProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const handleFileChosen = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    // Reset so selecting the same file again re-triggers change.
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
        <div>
          <Title order={3}>{UI_TEXT.dashboardTitle}</Title>
          <Text size="sm" c="dimmed">
            {UI_TEXT.appName} — {pages.length} {pages.length === 1 ? 'page' : 'pages'}
          </Text>
        </div>
        <Group gap="xs" wrap="nowrap">
          <Button
            variant="light"
            size="sm"
            leftSection={<IconFileImport size={16} />}
            onClick={() => fileInputRef.current?.click()}
            data-testid="dashboard-import-markdown"
          >
            {UI_TEXT.markdownImportLabel}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,text/markdown,text/plain"
            onChange={handleFileChosen}
            style={{ display: 'none' }}
            tabIndex={-1}
          />
        </Group>
      </div>

      {importError ? (
        <Alert
          color="red"
          variant="light"
          title="Import failed"
          onClose={() => setImportError(null)}
          withCloseButton
        >
          {importError}
        </Alert>
      ) : null}

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
