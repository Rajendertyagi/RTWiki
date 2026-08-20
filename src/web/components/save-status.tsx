import { Text } from '@mantine/core'
import type { MutationStatus } from '../hooks/use-pages-controller.js'
import { UI_TEXT } from '../config/index.js'

interface SaveStatusProps {
  status: MutationStatus
}

const STATUS_CONFIG: Record<MutationStatus, { text: string; color: string } | null> = {
  idle: null,
  saving: { text: UI_TEXT.saveStatusSaving, color: 'dimmed' },
  saved: { text: UI_TEXT.saveStatusSaved, color: 'green' },
  error: { text: UI_TEXT.saveStatusError, color: 'red' }
}

export function SaveStatus({ status }: SaveStatusProps): JSX.Element | null {
  const config = STATUS_CONFIG[status]
  if (!config) return null

  return (
    <Text size="sm" c={config.color} aria-live="polite">
      {config.text}
    </Text>
  )
}
