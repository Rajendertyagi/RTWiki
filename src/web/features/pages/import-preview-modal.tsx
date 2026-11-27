import { Alert, Button, Group, Loader, Modal, Stack, Text } from '@mantine/core'
import { IconAlertCircle, IconFileImport } from '@tabler/icons-react'
import { useMemo } from 'react'
import { PageTypeBadge } from '../../components/page-type-badge.js'
import { UI_TEXT } from '../../config/index.js'
import type { ImportPreview } from '../../services/import-api.js'

/** Byte units, named so the formatter holds no unexplained literals. */
const BYTES_PER_KB = 1024
const BYTES_PER_MB = BYTES_PER_KB * 1024

function formatSize(bytes: number): string {
  if (bytes >= BYTES_PER_MB) return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`
  if (bytes >= BYTES_PER_KB) return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`
  return `${bytes} B`
}

interface ImportPreviewModalProps {
  opened: boolean
  preview: ImportPreview | null
  confirming: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The preview-before-confirm gate for file import.
 *
 * Cancellation is deliberately just `onCancel`: no confirm request is made, so
 * the server creates nothing. The preview itself is read-only on the server;
 * this modal only decides whether to spend the one-time preview id.
 */
export function ImportPreviewModal({
  opened,
  preview,
  confirming,
  onConfirm,
  onCancel
}: ImportPreviewModalProps): JSX.Element {
  // Two identical files produce identical descriptors, so a key derived from
  // their fields can collide. Generate one stable id per page for the lifetime
  // of this preview instead; it changes only when a new preview is supplied.
  const pages = useMemo(
    () => (preview?.pages ?? []).map((page) => ({ page, key: crypto.randomUUID() })),
    [preview]
  )

  return (
    <Modal opened={opened} onClose={onCancel} title={UI_TEXT.importPreviewTitle} centered size="md">
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {UI_TEXT.importPreviewDescription}
        </Text>

        <Text size="sm" fw={600}>
          {UI_TEXT.importPreviewProposedLabel}
        </Text>

        {pages.map(({ page, key }) => (
          <Stack key={key} gap="xs">
            <Group gap="sm" justify="space-between" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                <IconFileImport size={18} aria-hidden="true" />
                <Text size="sm" fw={600}>
                  {page.title}
                </Text>
              </Group>
              <Group gap="xs" wrap="nowrap">
                <PageTypeBadge pageType={page.pageType} />
                <Text size="xs" c="dimmed">
                  {formatSize(page.byteSize)}
                </Text>
              </Group>
            </Group>
            <Text size="xs" c="dimmed">
              {page.originalName} · {page.mimeType}
            </Text>
            {page.warnings.map((warning) => (
              <Alert
                key={warning.code}
                icon={<IconAlertCircle size={16} />}
                color="yellow"
                variant="light"
              >
                {warning.message}
              </Alert>
            ))}
          </Stack>
        ))}

        <Group justify="flex-end" gap="sm">
          <Button variant="subtle" onClick={onCancel} disabled={confirming}>
            {UI_TEXT.cancelButton}
          </Button>
          <Button onClick={onConfirm} disabled={confirming || preview === null}>
            {confirming ? (
              <Group gap="xs">
                <Loader size="xs" />
                {UI_TEXT.importPreviewConfirming}
              </Group>
            ) : (
              UI_TEXT.importPreviewConfirm
            )}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
