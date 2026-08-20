import { Stack, Text, Paper } from '@mantine/core'
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
    <div className={classes.workspace}>
      <EditorHeader
        page={page}
        mutationStatus={mutationStatus}
        onBack={onBack}
        onRename={onRename}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />

      <div className={classes.content}>
        <Paper p="md" radius="md" className={classes.preview}>
          <Stack gap="sm">
            {page.content ? (
              <Text size="sm" className={classes.contentText}>
                {page.content}
              </Text>
            ) : (
              <Text size="sm" c="dimmed" fs="italic">
                {UI_TEXT.editorPlaceholderContent}
              </Text>
            )}
          </Stack>
        </Paper>
      </div>
    </div>
  )
}
