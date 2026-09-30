import {
  Alert,
  Button,
  Group,
  Modal,
  Radio,
  SegmentedControl,
  Stack,
  Text,
  TextInput
} from '@mantine/core'
import type { PageType } from '@rtwiki/shared/contracts/pages'
import { IconAlertCircle } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { RICH_TEMPLATES, type RichTemplateKey } from '../rich-editor/rich-templates.js'

const TEMPLATE_OPTIONS = (Object.keys(RICH_TEMPLATES) as RichTemplateKey[]).map((key) => ({
  value: key,
  label: UI_TEXT[RICH_TEMPLATES[key].labelKey]
}))

interface NewPageDialogProps {
  opened: boolean
  onClose: () => void
  onCreate: (title: string, pageType: PageType, template?: RichTemplateKey) => Promise<void>
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
  const [template, setTemplate] = useState<RichTemplateKey>('blank')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (opened) {
      setTitle('')
      setPageType(initialType)
      setTemplate('blank')
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
      await onCreate(trimmed, pageType, pageType === 'rich' ? template : undefined)
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
          // BOTH are required, and `autoFocus` alone is not sufficient.
          //
          // Mantine's `Modal` wraps its content in a focus trap
          // (`useFocusTrap`, node_modules/@mantine/hooks) that picks an initial
          // target on a `setTimeout(0)`, i.e. one macrotask AFTER React has
          // already applied `autoFocus`. Its selection is: an element carrying
          // `data-autofocus`, else the first tabbable descendant. This Modal
          // renders a `title`, so `withCloseButton` defaults to true and the
          // close button precedes the body in DOM order - it was therefore
          // first tabbable, and the trap moved focus onto the CLOSE BUTTON.
          //
          // The consequence is the same one the Ctrl+K finder had and fixed in
          // f145259: the first characters of a title were swallowed, and any
          // Space activated the focused button. Here that means `onClose` fired
          // and the dialog vanished mid-title - no data loss, since a title is
          // not a document, but the field looks like it is ignoring the
          // keyboard. `data-autofocus` makes the trap and `autoFocus` agree;
          // `autoFocus` stays as the fallback for a no-trap render.
          //
          // The finder's other half - the editor's focus poll reclaiming the
          // caret from a button while a dialog is open - is already in place
          // (`rich-editor.tsx:423`), so it does not need repeating here.
          data-autofocus
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
              value="markdown"
              label={UI_TEXT.markdownPage}
              data-testid="new-page-type-markdown"
            />
          </Group>
        </Radio.Group>

        {pageType === 'rich' ? (
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              {UI_TEXT.richTemplateLabel}
            </Text>
            <SegmentedControl
              fullWidth
              data={TEMPLATE_OPTIONS}
              value={template}
              onChange={(value) => setTemplate(value as RichTemplateKey)}
              aria-label={UI_TEXT.richTemplateLabel}
            />
          </Stack>
        ) : null}

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
