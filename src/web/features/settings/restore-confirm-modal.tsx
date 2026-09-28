import { Button, Group, Loader, Modal, Stack, Text } from '@mantine/core'
import { UI_TEXT } from '../../config/index.js'
import { formatDate } from '../../util/format-date.js'

export interface RestoreConfirmModalProps {
  opened: boolean
  /** The backup file's name, as it appears in data/backups/. */
  filename: string
  /** When it was taken, ISO. Null when the file could not be inspected. */
  modifiedAt: string | null
  byteSize: number | null
  /** Where the current database will be moved, shown so recovery is not a promise. */
  preRestorePath: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Human-readable file size. Binary units, because that is what the disk shows. */
function formatSize(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/**
 * Restore confirmation.
 *
 * Its own component rather than a reuse of `DeleteConfirmModal`, because restore
 * is the more destructive of the two: delete removes a page, restore replaces
 * the entire database and stops the process. The three things a user must be told
 * before agreeing are which backup, that their current notes are *moved* rather
 * than deleted and where to, and that RTWiki is about to close. A dialog shaped
 * for delete would say none of that.
 */
export function RestoreConfirmModal(props: RestoreConfirmModalProps) {
  const { opened, filename, modifiedAt, byteSize, preRestorePath, busy } = props
  const when = modifiedAt === null ? '—' : formatDate(modifiedAt)

  return (
    <Modal opened={opened} onClose={props.onCancel} title={UI_TEXT.backupRestoreTitle} centered>
      <Stack gap="sm">
        <Text size="sm" w={500}>
          {UI_TEXT.backupRestoreIntro.replace('{file}', filename)}
        </Text>
        <Text size="xs" c="dimmed">
          {UI_TEXT.backupRestoreWhen
            .replace('{when}', when)
            .replace('{size}', formatSize(byteSize))}
        </Text>

        <Text size="sm">{UI_TEXT.backupRestoreReplaces}</Text>
        <Text size="sm">{UI_TEXT.backupRestoreMoveAside.replace('{path}', preRestorePath)}</Text>
        <Text size="sm">{UI_TEXT.backupRestoreShutsDown}</Text>

        <Group justify="flex-end" mt="sm">
          <Button variant="subtle" onClick={props.onCancel} disabled={busy}>
            {UI_TEXT.backupRestoreCancel}
          </Button>
          <Button
            color="red"
            onClick={props.onConfirm}
            disabled={busy}
            data-testid="backup-restore-confirm"
          >
            {busy ? <Loader size="xs" color="white" /> : UI_TEXT.backupRestoreConfirm}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
