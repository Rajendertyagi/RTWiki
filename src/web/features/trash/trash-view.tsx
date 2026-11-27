import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Modal,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
  Tooltip
} from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import {
  IconArrowBackUp,
  IconCode,
  IconFileText,
  IconHierarchy,
  IconPaperclip,
  IconTrash,
  IconTrashX
} from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import classes from './trash-view.module.css'

interface TrashViewProps {
  onRestorePage?: (pageId: string) => void
}

/**
 * The trash list as returned by `GET /api/attachments/trash`.
 *
 * Kept local to this feature because the attachment trash endpoints are not yet
 * represented by a shared contract. The fields are exactly those the list needs
 * to render; `deletedAt` is nullable because a row can be restored between the
 * list read and the render.
 */
interface TrashedAttachment {
  id: string
  originalName: string
  mimeType: string
  kind: string
  byteSize: number
  deletedAt: string | null
}

export function TrashView({ onRestorePage }: TrashViewProps): JSX.Element {
  const [trashedPages, setTrashedPages] = useState<Page[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const [trashedAttachments, setTrashedAttachments] = useState<TrashedAttachment[]>([])
  const [attachmentsLoading, setAttachmentsLoading] = useState(true)
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null)
  const [confirmPurgeId, setConfirmPurgeId] = useState<string | null>(null)

  // Stable identity so the effect below can depend on it. It closes over nothing
  // but the state setters, which are themselves stable, so an empty dependency
  // list is accurate rather than merely convenient.
  const fetchTrash = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/pages/trash')
      if (!res.ok) {
        throw new Error('Failed to fetch trashed pages')
      }
      const data = (await res.json()) as { pages: Page[] }
      setTrashedPages(data.pages)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchTrashedAttachments = useCallback(async (): Promise<void> => {
    setAttachmentsLoading(true)
    setAttachmentsError(null)
    try {
      const res = await fetch('/api/attachments/trash')
      if (!res.ok) throw new Error(UI_TEXT.attachmentLoadFailed)
      const data = (await res.json()) as { attachments: TrashedAttachment[] }
      setTrashedAttachments(data.attachments)
    } catch {
      // A transport failure and a refused response both leave the list empty;
      // one clear sentence is more useful than a raw network error string.
      setAttachmentsError(UI_TEXT.attachmentLoadFailed)
    } finally {
      setAttachmentsLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchTrash()
  }, [fetchTrash])

  useEffect(() => {
    void fetchTrashedAttachments()
  }, [fetchTrashedAttachments])

  const handleRestore = async (id: string): Promise<void> => {
    try {
      const res = await fetch(`/api/pages/${id}/restore`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to restore page')
      setTrashedPages((prev) => prev.filter((p) => p.id !== id))
      onRestorePage?.(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handlePermanentDelete = async (id: string): Promise<void> => {
    try {
      // The query parameter is the deliberate speed bump for every irreversible
      // delete, exactly as the attachment purge below does. The server refuses
      // the call with 400 confirmation_required without it.
      const res = await fetch(`/api/pages/${id}/permanent?confirm=permanent`, {
        method: 'DELETE'
      })
      if (!res.ok) throw new Error('Failed to permanently delete page')
      setTrashedPages((prev) => prev.filter((p) => p.id !== id))
      setConfirmDeleteId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRestoreAttachment = async (id: string): Promise<void> => {
    setAttachmentsError(null)
    try {
      const res = await fetch(`/api/attachments/${id}/restore`, { method: 'POST' })
      if (!res.ok) throw new Error(UI_TEXT.attachmentRestoreFailed)
      await fetchTrashedAttachments()
    } catch {
      setAttachmentsError(UI_TEXT.attachmentRestoreFailed)
    }
  }

  const handlePurgeAttachment = async (id: string): Promise<void> => {
    setAttachmentsError(null)
    try {
      // The query parameter is the deliberate speed bump for every irreversible
      // delete. It is sent only after the confirmation modal was accepted.
      const res = await fetch(`/api/attachments/${id}/permanent?confirm=permanent`, {
        method: 'DELETE'
      })
      if (!res.ok) throw new Error(UI_TEXT.attachmentPurgeFailed)
      setConfirmPurgeId(null)
      await fetchTrashedAttachments()
    } catch {
      setAttachmentsError(UI_TEXT.attachmentPurgeFailed)
    }
  }

  const renderTypeIcon = (type: Page['pageType']) => {
    switch (type) {
      case 'html':
        return <IconCode size={16} />
      case 'diagram':
        return <IconHierarchy size={16} />
      default:
        return <IconFileText size={16} />
    }
  }

  return (
    <Container size="lg" py="md">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <IconTrash size={24} color="var(--mantine-color-gray-6)" />
            <Title order={2}>{UI_TEXT.trashTitle}</Title>
          </Group>
          <Badge variant="light" color="gray" data-testid="trash-count-badge">
            {trashedPages.length} {trashedPages.length === 1 ? 'page' : 'pages'}
          </Badge>
        </Group>

        <Tabs defaultValue="pages" variant="outline">
          <Tabs.List>
            <Tabs.Tab value="pages" leftSection={<IconFileText size={16} />}>
              {UI_TEXT.trashTabPages}
            </Tabs.Tab>
            <Tabs.Tab value="attachments" leftSection={<IconPaperclip size={16} />}>
              {UI_TEXT.trashTabAttachments}
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="pages" pt="md">
            {error ? (
              <Text c="red" size="sm">
                {error}
              </Text>
            ) : null}

            {loading ? (
              <Text size="sm" c="dimmed">
                {UI_TEXT.loadingPages}
              </Text>
            ) : trashedPages.length === 0 ? (
              <Card withBorder p="xl" radius="md">
                <Stack align="center" gap="xs" py="lg">
                  <IconTrash size={48} color="var(--mantine-color-gray-4)" />
                  <Text fw={600} size="lg">
                    {UI_TEXT.trashEmpty}
                  </Text>
                  <Text size="sm" c="dimmed" ta="center">
                    {UI_TEXT.trashEmptySubtitle}
                  </Text>
                </Stack>
              </Card>
            ) : (
              <Card withBorder padding={0} radius="md">
                <Table highlightOnHover verticalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{UI_TEXT.trashColumnTitle}</Table.Th>
                      <Table.Th>{UI_TEXT.trashColumnType}</Table.Th>
                      <Table.Th>{UI_TEXT.trashColumnDeletedAt}</Table.Th>
                      <Table.Th className={classes.actionsCell}>
                        {UI_TEXT.trashColumnActions}
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {trashedPages.map((page) => (
                      <Table.Tr key={page.id}>
                        <Table.Td>
                          <Group gap="xs">
                            {renderTypeIcon(page.pageType)}
                            <Text fw={500} size="sm">
                              {page.title || UI_TEXT.untitledPage}
                            </Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="subtle" size="sm" tt="capitalize">
                            {page.pageType}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {page.deletedAt ? new Date(page.deletedAt).toLocaleString() : '-'}
                          </Text>
                        </Table.Td>
                        <Table.Td className={classes.actionsCell}>
                          <Group gap="xs" justify="flex-end">
                            <Tooltip label={UI_TEXT.restoreAction}>
                              <ActionIcon
                                className={classes.actionButton}
                                variant="light"
                                color="blue"
                                size="sm"
                                aria-label={UI_TEXT.restoreAction}
                                onClick={() => void handleRestore(page.id)}
                              >
                                <IconArrowBackUp size={16} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label={UI_TEXT.permanentDeleteAction}>
                              <ActionIcon
                                className={classes.actionButton}
                                variant="light"
                                color="red"
                                size="sm"
                                aria-label={UI_TEXT.permanentDeleteAction}
                                onClick={() => setConfirmDeleteId(page.id)}
                              >
                                <IconTrashX size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Card>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="attachments" pt="md">
            {attachmentsError ? (
              <Text c="red" size="sm">
                {attachmentsError}
              </Text>
            ) : null}

            {attachmentsLoading ? (
              <Text size="sm" c="dimmed">
                {UI_TEXT.loadingAttachments}
              </Text>
            ) : trashedAttachments.length === 0 ? (
              <Card withBorder p="xl" radius="md">
                <Stack align="center" gap="xs" py="lg">
                  <IconPaperclip size={48} color="var(--mantine-color-gray-4)" />
                  <Text fw={600} size="lg">
                    {UI_TEXT.trashAttachmentsEmpty}
                  </Text>
                  <Text size="sm" c="dimmed" ta="center">
                    {UI_TEXT.trashAttachmentsEmptySubtitle}
                  </Text>
                </Stack>
              </Card>
            ) : (
              <Card withBorder padding={0} radius="md">
                <Table highlightOnHover verticalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{UI_TEXT.trashColumnName}</Table.Th>
                      <Table.Th>{UI_TEXT.trashColumnType}</Table.Th>
                      <Table.Th>{UI_TEXT.trashColumnDeletedAt}</Table.Th>
                      <Table.Th className={classes.actionsCell}>
                        {UI_TEXT.trashColumnActions}
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {trashedAttachments.map((attachment) => (
                      <Table.Tr key={attachment.id}>
                        <Table.Td>
                          <Group gap="xs">
                            <IconPaperclip size={16} />
                            <Stack gap={0}>
                              <Text fw={500} size="sm">
                                {attachment.originalName}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {attachment.mimeType}
                              </Text>
                            </Stack>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="subtle" size="sm" tt="capitalize">
                            {attachment.kind}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {attachment.deletedAt
                              ? new Date(attachment.deletedAt).toLocaleString()
                              : '-'}
                          </Text>
                        </Table.Td>
                        <Table.Td className={classes.actionsCell}>
                          <Group gap="xs" justify="flex-end">
                            <Tooltip label={UI_TEXT.attachmentRestoreLabel}>
                              <ActionIcon
                                className={classes.actionButton}
                                variant="light"
                                color="blue"
                                size="sm"
                                aria-label={UI_TEXT.attachmentRestoreLabel}
                                onClick={() => void handleRestoreAttachment(attachment.id)}
                              >
                                <IconArrowBackUp size={16} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label={UI_TEXT.attachmentPurgeLabel}>
                              <ActionIcon
                                className={classes.actionButton}
                                variant="light"
                                color="red"
                                size="sm"
                                aria-label={UI_TEXT.attachmentPurgeLabel}
                                onClick={() => setConfirmPurgeId(attachment.id)}
                              >
                                <IconTrashX size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Card>
            )}
          </Tabs.Panel>
        </Tabs>
      </Stack>

      <Modal
        opened={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        title={UI_TEXT.permanentDeleteAction}
        centered
      >
        <Stack gap="md">
          <Text size="sm">{UI_TEXT.permanentDeleteConfirmation}</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setConfirmDeleteId(null)}>
              {UI_TEXT.cancelButton}
            </Button>
            <Button
              color="red"
              onClick={() => {
                if (confirmDeleteId) void handlePermanentDelete(confirmDeleteId)
              }}
            >
              {UI_TEXT.permanentDeleteAction}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={confirmPurgeId !== null}
        onClose={() => setConfirmPurgeId(null)}
        title={UI_TEXT.attachmentPurgeTitle}
        centered
      >
        <Stack gap="md">
          <Text size="sm">{UI_TEXT.attachmentPurgeConfirmation}</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setConfirmPurgeId(null)}>
              {UI_TEXT.cancelButton}
            </Button>
            <Button
              color="red"
              onClick={() => {
                if (confirmPurgeId) void handlePurgeAttachment(confirmPurgeId)
              }}
            >
              {UI_TEXT.attachmentPurgeLabel}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  )
}
