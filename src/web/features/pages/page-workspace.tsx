import { Stack, Text, Title, Paper } from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import type { MutationStatus } from '../../hooks/use-pages-controller.js'
import { UI_TEXT } from '../../config/index.js'
import { EditorHeader } from './editor-header.js'
import classes from './page-workspace.module.css'

interface PageWorkspaceProps {
  page: Page
  mutationStatus: MutationStatus
  onBack: () => void
  onRename: (title: string) => Promise<boolean>
  onDuplicate: () => void
  onDelete: () => void
}

export function PageWorkspace({
  page,
  mutationStatus,
  onBack,
  onRename,
  onDuplicate,
  onDelete
}: PageWorkspaceProps): JSX.Element {
  return (
    <Stack gap={0} className={classes.workspace}>
      <EditorHeader
        page={page}
        mutationStatus={mutationStatus}
        onBack={onBack}
        onRename={onRename}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />

      <div className={classes.content}>
        <Paper withBorder p="md" radius="md" className={classes.preview}>
          <Stack gap="sm">
            <Title order={4}>{page.title || UI_TEXT.untitledPage}</Title>
            <Text size="sm" c="dimmed">
              {UI_TEXT.editorPlaceholderContent}
            </Text>
            {page.content ? (
              <Text size="sm" className={classes.contentText}>
                {page.content}
              </Text>
            ) : (
              <Text size="sm" c="dimmed" fs="italic">
                No content yet.
              </Text>
            )}
            <Text size="xs" c="dimmed">
              ID: {page.id} · Updated: {new Date(page.updatedAt).toLocaleString()}
            </Text>
          </Stack>
        </Paper>
      </div>
    </Stack>
  )
}
