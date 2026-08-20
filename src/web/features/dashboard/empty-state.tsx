import { Button, Group, Stack, Text, Title } from '@mantine/core'
import { IconPlus, IconNotes } from '@tabler/icons-react'
import { UI_TEXT } from '../../config/index.js'
import classes from './dashboard.module.css'

interface EmptyStateProps {
  onCreateRich: () => void
  onCreateHtml: () => void
}

export function EmptyState({ onCreateRich, onCreateHtml }: EmptyStateProps): JSX.Element {
  return (
    <div className={classes.emptyWrap}>
      <Stack align="center" gap="md">
        <IconNotes size={48} color="var(--mantine-color-dimmed)" />
        <Title order={3}>{UI_TEXT.emptyTitle}</Title>
        <Text c="dimmed" ta="center">
          {UI_TEXT.emptyDescription}
        </Text>
        <Group justify="center" gap="sm">
          <Button leftSection={<IconPlus size={16} />} onClick={onCreateRich}>
            {UI_TEXT.createRichNote}
          </Button>
          <Button leftSection={<IconPlus size={16} />} variant="outline" onClick={onCreateHtml}>
            {UI_TEXT.createHtmlPage}
          </Button>
        </Group>
      </Stack>
    </div>
  )
}
