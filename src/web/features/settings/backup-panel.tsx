import { Alert, Button, Group, Loader, Stack, Switch, Table, Text, TextInput } from '@mantine/core'
import {
  BACKUP_SLOTS,
  type BackupSlot,
  type BackupValidationReason
} from '@rtwiki/shared/constants'
import { useCallback, useEffect, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import {
  type BackupFailure,
  type BackupOverview,
  type BackupSlotFile,
  fetchBackups,
  inspectBackup,
  restoreBackup,
  runBackup,
  saveBackupSettings
} from '../../services/backup-api.js'
import { formatDate, formatRelativeTime } from '../../util/format-date.js'
import { fetchShutdownToken } from '../shutdown/shutdown-client.js'
import { RestoreConfirmModal } from './restore-confirm-modal.js'

const PERIOD_LABEL: Record<BackupSlot, string> = {
  daily: UI_TEXT.backupPeriodDaily,
  weekly: UI_TEXT.backupPeriodWeekly,
  monthly: UI_TEXT.backupPeriodMonthly
}

/** Maps a server reason code to the sentence the user reads. */
function messageForReason(reason: BackupValidationReason | BackupFailure): string {
  switch (reason) {
    case 'not-a-file':
      return UI_TEXT.backupFailedNotAFile
    case 'not-a-database':
      return UI_TEXT.backupFailedNotADatabase
    case 'corrupt':
      return UI_TEXT.backupFailedCorrupt
    case 'foreign-key-violation':
      return UI_TEXT.backupFailedForeignKey
    case 'schema-too-new':
      return UI_TEXT.backupFailedSchemaTooNew
    case 'schema-missing-migration':
      return UI_TEXT.backupFailedSchemaMissing
    case 'mid-migration-attachments':
      return UI_TEXT.backupFailedMidMigration
    case 'insufficient-disk-space':
      return UI_TEXT.backupFailedDiskSpace
    case 'unavailable':
      return UI_TEXT.backupFailedUnavailable
    default:
      return UI_TEXT.backupFailedWrite
  }
}

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
 * The Backup settings panel.
 *
 * A spinner rather than a progress bar, because `VACUUM INTO` reports no
 * progress: there is nothing to report. `Progress` is used nowhere else in the
 * app, so a bar would also be an unfamiliar element introduced for something the
 * mechanism cannot support.
 *
 * Kept as its own file and mounted conditionally, following how `DebugLogViewer`
 * is mounted, rather than inlined into the settings switch.
 */
export function BackupPanel(): JSX.Element {
  const [overview, setOverview] = useState<BackupOverview | null>(null)
  const [running, setRunning] = useState<BackupSlot | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<BackupSlotFile | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [reopened, setReopened] = useState(false)

  const reload = useCallback(async () => {
    setOverview(await fetchBackups())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function handleToggle(slot: BackupSlot, enabled: boolean): Promise<void> {
    if (!overview) return
    const next = {
      ...overview.settings.slots,
      [slot]: { ...overview.settings.slots[slot], enabled }
    }
    setProblem(null)
    const saved = await saveBackupSettings(next)
    if (saved === null) {
      setProblem(UI_TEXT.backupFailedWrite)
      return
    }
    setOverview({ ...overview, settings: { slots: saved.slots } })
  }

  async function handleInterval(slot: BackupSlot, hours: number): Promise<void> {
    if (!overview) return
    const current = overview.settings.slots[slot].intervalHours
    // Applied on blur rather than per keystroke: an interval is a whole number
    // of hours, so there is nothing meaningful to save while it is half-typed.
    if (!Number.isInteger(hours) || hours === current) return
    const next = {
      ...overview.settings.slots,
      [slot]: { ...overview.settings.slots[slot], intervalHours: hours }
    }
    setProblem(null)
    const saved = await saveBackupSettings(next)
    if (saved === null) {
      setProblem(UI_TEXT.backupFailedWrite)
      return
    }
    setOverview({ ...overview, settings: { slots: saved.slots } })
  }

  async function handleRunNow(slot: BackupSlot): Promise<void> {
    setRunning(slot)
    setProblem(null)
    const failure = await runBackup(slot)
    setRunning(null)
    if (failure !== null) {
      setProblem(messageForReason(failure))
    }
    await reload()
  }

  /** The verdict is fetched before the dialog opens, not after it is confirmed. */
  async function handleRestore(file: BackupSlotFile): Promise<void> {
    setProblem(null)
    const verdict = await inspectBackup(file.filename)
    if (verdict === null) {
      setProblem(UI_TEXT.backupUnreadable)
      return
    }
    if ('kind' in verdict) {
      setProblem(
        verdict.kind === 'unavailable' ? UI_TEXT.backupFailedUnavailable : UI_TEXT.backupUnreadable
      )
      return
    }
    if (!verdict.ok) {
      setProblem(messageForReason(verdict.reason))
      return
    }
    setConfirming({ ...file, modifiedAt: verdict.candidate.modifiedAt })
  }

  /**
   * The one irreversible action in the app.
   *
   * The success message is shown from the response alone and deliberately not
   * re-fetched afterwards: the server has begun shutting down by the time it
   * replies, so anything that waited on a second request would be racing the
   * process it is talking to. There is no relaunch -- nothing in this codebase
   * respawns the server -- so the user is simply told to reopen RTWiki.
   */
  async function handleConfirmRestore(): Promise<void> {
    if (confirming === null) return
    setRestoring(true)
    setProblem(null)
    const token = await fetchShutdownToken()
    if (token === null) {
      setRestoring(false)
      setProblem(UI_TEXT.backupFailedUnavailable)
      return
    }
    const result = await restoreBackup(confirming.filename, token)
    setRestoring(false)
    if (!result.ok) {
      setConfirming(null)
      setProblem(UI_TEXT.backupRestoreRefused)
      return
    }
    setConfirming(null)
    setReopened(true)
  }

  if (reopened) {
    return (
      <Stack gap="sm">
        <Alert color="green" data-testid="backup-restored">
          {UI_TEXT.backupRestoredReopen}
        </Alert>
      </Stack>
    )
  }

  if (overview === null) {
    return (
      <Text size="sm" c="dimmed" data-testid="backup-panel-loading">
        {UI_TEXT.backupUnreadable}
      </Text>
    )
  }

  return (
    <Stack gap="md">
      <Text size="xs" c="dimmed">
        {UI_TEXT.backupIntro}
      </Text>

      {problem !== null && (
        <Alert color="red" data-testid="backup-panel-problem">
          {problem}
        </Alert>
      )}

      {BACKUP_SLOTS.map((slot) => {
        const config = overview.settings.slots[slot]
        const file = overview.backups.find((b) => b.slot === slot)
        return (
          <Stack key={slot} gap="xs">
            <Group justify="space-between" wrap="nowrap">
              <div>
                <Text size="sm" w={500}>
                  {PERIOD_LABEL[slot]}
                </Text>
                <Text size="xs" c="dimmed" data-testid={`backup-when-${slot}`}>
                  {file?.modifiedAt
                    ? UI_TEXT.backupLastTaken.replace('{when}', formatRelativeTime(file.modifiedAt))
                    : UI_TEXT.backupNeverTaken}
                </Text>
              </div>
              <Switch
                checked={config.enabled}
                onChange={(event) => {
                  void handleToggle(slot, event.currentTarget.checked)
                }}
                aria-label={PERIOD_LABEL[slot]}
                data-testid={`backup-enabled-${slot}`}
              />
            </Group>

            <Group gap="xs" align="flex-end">
              <TextInput
                size="xs"
                label={UI_TEXT.backupEveryHours.replace('{hours}', '').trim()}
                value={String(config.intervalHours)}
                onChange={(event) => {
                  const parsed = Number(event.currentTarget.value)
                  if (Number.isFinite(parsed)) {
                    setOverview({
                      ...overview,
                      settings: {
                        slots: {
                          ...overview.settings.slots,
                          [slot]: { ...config, intervalHours: parsed }
                        }
                      }
                    })
                  }
                }}
                onBlur={(event) => {
                  void handleInterval(slot, Number(event.currentTarget.value))
                }}
                disabled={!config.enabled}
                w={110}
                data-testid={`backup-interval-${slot}`}
              />
              <Button
                size="xs"
                variant="default"
                onClick={() => {
                  void handleRunNow(slot)
                }}
                disabled={running !== null}
                leftSection={running === slot ? <Loader size="xs" /> : undefined}
                data-testid={`backup-run-${slot}`}
              >
                {running === slot ? UI_TEXT.backupRunning : UI_TEXT.backupRunNow}
              </Button>
            </Group>
          </Stack>
        )
      })}

      <Table highlightOnHover verticalSpacing="sm" data-testid="backup-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{PERIOD_LABEL.daily}</Table.Th>
            <Table.Th>{UI_TEXT.backupRestore}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {BACKUP_SLOTS.map((slot) => {
            const file = overview.backups.find((b) => b.slot === slot)
            return (
              <Table.Tr key={slot}>
                <Table.Td>
                  <Text size="xs">{file?.modifiedAt ? formatDate(file.modifiedAt) : '—'}</Text>
                  <Text size="xs" c="dimmed">
                    {formatSize(file?.byteSize ?? null)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {file?.filename ?? UI_TEXT.backupNeverTaken}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    disabled={!file}
                    onClick={() => {
                      if (file) void handleRestore(file)
                    }}
                    data-testid={`backup-restore-${slot}`}
                  >
                    {UI_TEXT.backupRestore}
                  </Button>
                </Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>

      <RestoreConfirmModal
        opened={confirming !== null}
        filename={confirming?.filename ?? ''}
        modifiedAt={confirming?.modifiedAt ?? null}
        byteSize={confirming?.byteSize ?? null}
        preRestorePath="data/rtwiki.pre-restore-<timestamp>.sqlite"
        busy={restoring}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          void handleConfirmRestore()
        }}
      />
    </Stack>
  )
}
