import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Group,
  Modal,
  Stack,
  Table,
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
  IconSitemap,
  IconTrash,
  IconTrashX
} from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'

interface TrashViewProps {
  onRestorePage?: (pageId: string) => void
}

export function TrashView({ onRestorePage }: TrashViewProps): JSX.Element {
  const [trashedPages, setTrashedPages] = useState<Page[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const fetchTrash = async (): Promise<void> => {
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
  }

  useEffect(() => {
    void fetchTrash()
  }, [])

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
      const res = await fetch(`/api/pages/${id}/permanent`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to permanently delete page')
      setTrashedPages((prev) => prev.filter((p) => p.id !== id))
      setConfirmDeleteId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const renderTypeIcon = (type: Page['pageType']) => {
    switch (type) {
      case 'html':
        return <IconCode size={16} />
      case 'diagram':
        return <IconHierarchy size={16} />
      case 'mindmap':
        return <IconSitemap size={16} />
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
          <Badge variant="light" color="gray">
            {trashedPages.length} {trashedPages.length === 1 ? 'page' : 'pages'}
          </Badge>
        </Group>

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
                  <Table.Th>Title</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Deleted At</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
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
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Group gap="xs" justify="flex-end">
                        <Tooltip label={UI_TEXT.restoreAction}>
                          <ActionIcon
                            variant="light"
                            color="blue"
                            size="sm"
                            onClick={() => void handleRestore(page.id)}
                          >
                            <IconArrowBackUp size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={UI_TEXT.permanentDeleteAction}>
                          <ActionIcon
                            variant="light"
                            color="red"
                            size="sm"
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
    </Container>
  )
}
