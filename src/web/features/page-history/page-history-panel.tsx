import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Drawer,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  Title,
  Tooltip
} from '@mantine/core'
import type { RecoveryActor, RevisionCaptureKind } from '@rtwiki/shared/schemas/recovery'
import { IconEye, IconHistory, IconRotateClockwise } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { fetchPageRevisions, type PageRevision, restorePageRevision } from './page-history-api.js'
import classes from './page-history-panel.module.css'

interface PageHistoryPanelProps {
  pageId: string
  opened: boolean
  onClose: () => void
}

/** Absolute timestamp with a safe fallback for a malformed stored value. */
function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

/** Labels come from the dictionary, keyed by the shared capture-kind tuple. */
function captureKindLabel(kind: RevisionCaptureKind): string {
  switch (kind) {
    case 'before_update':
      return UI_TEXT.historyCaptureKindBeforeUpdate
    case 'before_soft_delete':
      return UI_TEXT.historyCaptureKindBeforeSoftDelete
    case 'before_restore':
      return UI_TEXT.historyCaptureKindBeforeRestore
    default:
      return kind
  }
}

/** Labels come from the dictionary, keyed by the shared actor tuple. */
function actorLabel(actor: RecoveryActor): string {
  switch (actor) {
    case 'local-client':
      return UI_TEXT.historyActorLocalClient
    case 'system':
      return UI_TEXT.historyActorSystem
    case 'ai':
      return UI_TEXT.historyActorAi
    default:
      return actor
  }
}

/**
 * Minimal revision history for the active page.
 *
 * The panel is owned by `EditorHeader` rather than the page workspace so the
 * trigger and the panel stay in one authorised change. The drawer portals out
 * of the header, so its placement in the DOM does not affect layout.
 */
export function PageHistoryPanel({ pageId, opened, onClose }: PageHistoryPanelProps): JSX.Element {
  const [revisions, setRevisions] = useState<PageRevision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [previewRevision, setPreviewRevision] = useState<PageRevision | null>(null)
  const [confirmRevision, setConfirmRevision] = useState<PageRevision | null>(null)
  const [restoring, setRestoring] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    setSuccess(false)
    const result = await fetchPageRevisions(pageId)
    if (result.ok) {
      setRevisions(result.revisions)
    } else {
      setRevisions([])
      setError(UI_TEXT.historyLoadFailed)
    }
    setLoading(false)
  }, [pageId])

  useEffect(() => {
    if (opened) void load()
  }, [opened, load])

  const handleRestore = async (revision: PageRevision): Promise<void> => {
    setRestoring(true)
    setError(null)
    setSuccess(false)
    const result = await restorePageRevision(pageId, revision.id)
    setRestoring(false)
    setConfirmRevision(null)

    if (result.ok) {
      setPreviewRevision(null)
      setSuccess(true)
      await load()
      return
    }

    // A refused restore never reports success. The expired case gets its own
    // plain-language sentence; every other refusal stays a visible failure.
    if (result.status === 410 && result.code === 'recovery_data_expired') {
      setError(UI_TEXT.historyRecoveryExpired)
    } else if (result.status === 404) {
      setError(UI_TEXT.historyRestoreUnavailable)
    } else {
      setError(UI_TEXT.historyRestoreFailed)
    }
  }

  return (
    <>
      <Drawer
        opened={opened}
        onClose={onClose}
        title={UI_TEXT.historyTitle}
        position="right"
        size="md"
        padding="md"
      >
        <Stack gap="md">
          {error ? (
            <Alert color="red">
              <Text size="sm">{error}</Text>
            </Alert>
          ) : null}

          {success ? (
            <Alert color="green" title={UI_TEXT.historyRestoreSuccess}>
              <Button
                variant="light"
                color="green"
                size="xs"
                onClick={() => window.location.reload()}
              >
                {UI_TEXT.historyReloadButton}
              </Button>
            </Alert>
          ) : null}

          {loading ? (
            <Loader size="sm" />
          ) : revisions.length === 0 ? (
            <Stack align="center" gap="xs" py="xl">
              <IconHistory size={40} color="var(--mantine-color-gray-4)" />
              <Title order={4}>{UI_TEXT.historyEmpty}</Title>
              <Text size="sm" c="dimmed" ta="center">
                {UI_TEXT.historyEmptySubtitle}
              </Text>
            </Stack>
          ) : (
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{UI_TEXT.historyColumnCapturedAt}</Table.Th>
                  <Table.Th>{UI_TEXT.historyColumnKind}</Table.Th>
                  <Table.Th>{UI_TEXT.historyColumnActor}</Table.Th>
                  <Table.Th>{UI_TEXT.historyColumnVersion}</Table.Th>
                  <Table.Th className={classes.actionsCell}>
                    {UI_TEXT.historyColumnActions}
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {revisions.map((revision) => (
                  <Table.Tr key={revision.id}>
                    <Table.Td>
                      <Text size="xs">{formatTimestamp(revision.capturedAt)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="subtle" size="sm">
                        {captureKindLabel(revision.captureKind)}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {actorLabel(revision.actor)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{revision.version}</Text>
                    </Table.Td>
                    <Table.Td className={classes.actionsCell}>
                      <Group gap="xs" justify="flex-end">
                        <Tooltip label={UI_TEXT.historyPreviewAction}>
                          <ActionIcon
                            className={classes.actionButton}
                            variant="light"
                            color="blue"
                            size="sm"
                            aria-label={UI_TEXT.historyPreviewAction}
                            onClick={() => setPreviewRevision(revision)}
                          >
                            <IconEye size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={UI_TEXT.historyRestoreAction}>
                          <ActionIcon
                            className={classes.actionButton}
                            variant="light"
                            color="orange"
                            size="sm"
                            aria-label={UI_TEXT.historyRestoreAction}
                            onClick={() => setConfirmRevision(revision)}
                          >
                            <IconRotateClockwise size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </Drawer>

      <Modal
        opened={previewRevision !== null}
        onClose={() => setPreviewRevision(null)}
        title={UI_TEXT.historyPreviewTitle}
        centered
        size="lg"
      >
        {previewRevision ? (
          <Stack gap="sm">
            <Text fw={600}>{previewRevision.title || UI_TEXT.untitledPage}</Text>
            <Group gap="xs">
              <Badge variant="subtle" size="sm">
                {captureKindLabel(previewRevision.captureKind)}
              </Badge>
              <Badge variant="subtle" size="sm">
                {actorLabel(previewRevision.actor)}
              </Badge>
              <Text size="xs" c="dimmed">
                {UI_TEXT.historyColumnVersion} {previewRevision.version}
              </Text>
              <Text size="xs" c="dimmed">
                {formatTimestamp(previewRevision.capturedAt)}
              </Text>
            </Group>
            <Text size="sm" fw={500}>
              {UI_TEXT.historyPreviewContentLabel}
            </Text>
            {previewRevision.content ? (
              <Text
                className={classes.contentPreview}
                size="xs"
                ff="monospace"
                c="dimmed"
                lineClamp={8}
              >
                {previewRevision.content}
              </Text>
            ) : (
              <Text size="sm" c="dimmed">
                {UI_TEXT.historyPreviewNoContent}
              </Text>
            )}
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => setPreviewRevision(null)}>
                {UI_TEXT.cancelButton}
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>

      <Modal
        opened={confirmRevision !== null}
        onClose={() => setConfirmRevision(null)}
        title={UI_TEXT.historyRestoreConfirmTitle}
        centered
      >
        <Stack gap="md">
          <Text size="sm">{UI_TEXT.historyRestoreConfirmMessage}</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setConfirmRevision(null)}>
              {UI_TEXT.cancelButton}
            </Button>
            <Button
              color="orange"
              loading={restoring}
              onClick={() => {
                if (confirmRevision) void handleRestore(confirmRevision)
              }}
            >
              {UI_TEXT.historyRestoreConfirmButton}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
