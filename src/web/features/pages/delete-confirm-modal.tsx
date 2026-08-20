import { Button, Group, Modal, Stack, Text } from '@mantine/core'
import { UI_TEXT } from '../../config/index.js'

interface DeleteConfirmModalProps {
  opened: boolean
  pageTitle: string
  onClose: () => void
  onConfirm: () => Promise<void>
}

export function DeleteConfirmModal({
  opened,
  pageTitle,
  onClose,
  onConfirm
}: DeleteConfirmModalProps): JSX.Element {
  return (
    <Modal opened={opened} onClose={onClose} title={UI_TEXT.deleteTitle} centered>
      <Stack gap="md">
        <Text size="sm">{UI_TEXT.deleteConfirmation}</Text>
        {pageTitle ? (
          <Text size="sm" fw={600}>
            {pageTitle}
          </Text>
        ) : null}
        <Group justify="flex-end" gap="sm">
          <Button variant="subtle" onClick={onClose}>
            {UI_TEXT.cancelButton}
          </Button>
          <Button color="red" onClick={onConfirm}>
            {UI_TEXT.deleteButton}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
