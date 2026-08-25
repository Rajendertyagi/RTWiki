import { Alert, Button, Group, Modal, Radio, Stack, TextInput } from '@mantine/core'
import type { PageType } from '@rtwiki/shared/contracts/pages'
import { IconAlertCircle } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'

interface NewPageDialogProps {
  opened: boolean
  onClose: () => void
  onCreate: (title: string, pageType: PageType) => Promise<void>
  initialType?: PageType
}

export function NewPageDialog({
  opened,
  onClose,
  onCreate,
  initialType = 'rich'
}: NewPageDialogProps): JSX.Element {
  const [title, setTitle] = useState('')
  const [pageType, setPageType] = useState<PageType>(initialType)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (opened) {
      setTitle('')
      setPageType(initialType)
      setError(null)
      setSubmitting(false)
    }
  }, [opened, initialType])

  const handleSubmit = async (): Promise<void> => {
    const trimmed = title.trim()
    if (!trimmed) {
      setError(UI_TEXT.titleRequired)
      return
    }
    if (trimmed.length > 200) {
      setError(UI_TEXT.titleTooLong)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onCreate(trimmed, pageType)
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : UI_TEXT.errorCreatingPage
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={UI_TEXT.newPageTitle} centered>
      <Stack gap="md">
        {error ? (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            {error}
          </Alert>
        ) : null}

        <TextInput
          label={UI_TEXT.titleLabel}
          placeholder={UI_TEXT.titlePlaceholder}
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSubmit()
          }}
          autoFocus
          maxLength={200}
          aria-label={UI_TEXT.titleLabel}
        />

        <Radio.Group
          label={UI_TEXT.typeLabel}
          value={pageType}
          onChange={(v) => setPageType(v as PageType)}
        >
          <Group mt="xs" gap="md">
            <Radio value="rich" label={UI_TEXT.richNote} />
            <Radio value="html" label={UI_TEXT.htmlPage} />
            <Radio
              value="diagram"
              label={UI_TEXT.diagramPage}
              data-testid="new-page-type-diagram"
            />
            <Radio
              value="mindmap"
              label={UI_TEXT.mindMapPage}
              data-testid="new-page-type-mindmap"
            />
          </Group>
        </Radio.Group>

        <Group justify="flex-end" gap="sm">
          <Button variant="subtle" onClick={onClose} disabled={submitting}>
            {UI_TEXT.cancelButton}
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {UI_TEXT.createButton}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
