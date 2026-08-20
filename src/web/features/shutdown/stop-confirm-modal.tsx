import { Modal, Text, Group, Button, Stack } from '@mantine/core'
import { UI_TEXT } from '../../config/index.js'

interface StopConfirmModalProps {
  opened: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
}

export function StopConfirmModal({
  opened,
  onClose,
  onConfirm
}: StopConfirmModalProps): JSX.Element {
  return (
    <Modal opened={opened} onClose={onClose} title={UI_TEXT.stopConfirmTitle} centered>
      <Stack gap="md">
        <Text size="sm">{UI_TEXT.stopConfirmMessage}</Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="subtle" onClick={onClose}>
            {UI_TEXT.cancelButton}
          </Button>
          <Button color="red" onClick={onConfirm}>
            {UI_TEXT.stopButton}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
