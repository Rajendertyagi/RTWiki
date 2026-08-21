import type { PartialBlock } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import { FormattingToolbar, useCreateBlockNote } from '@blocknote/react'
import { useComputedColorScheme } from '@mantine/core'
import type { AutosaveStatus } from './autosave-controller.js'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { Alert, Button, Stack, Text } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { updatePage } from '../../services/pages-api.js'
import { createDefaultDocument, parseStoredDocument } from './document.js'
import classes from './rich-editor.module.css'
import { useAutosave } from './use-autosave.js'

interface RichEditorProps {
  pageId: string
  storedContent: string
  pageTitle: string
  onFlushRef?: (fn: (() => Promise<boolean>) | null) => void
  onSaveStateChange?: (state: {
    isDirty: boolean
    saveState: 'clean' | 'saving' | 'saved' | 'error'
  }) => void
}

export function RichEditor({
  pageId,
  storedContent,
  onFlushRef,
  onSaveStateChange
}: RichEditorProps): JSX.Element {
  const parseResult = parseStoredDocument(storedContent)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [hasReset, setHasReset] = useState(false)

  const handleSave = async (pid: string, content: string): Promise<void> => {
    await updatePage(pid, { content })
  }

  const { status, error, isDirty, notifyEdit, save, retry, flush } = useAutosave({
    pageId,
    onSave: handleSave
  })

  // Sync state changes back to parent
  useEffect(() => {
    if (onSaveStateChange) {
      onSaveStateChange({ isDirty, saveState: status as 'clean' | 'saving' | 'saved' | 'error' })
    }
  }, [isDirty, status, onSaveStateChange])

  useEffect(() => {
    if (onFlushRef) onFlushRef(flush)
    return () => {
      if (onFlushRef) onFlushRef(null)
    }
  }, [flush, onFlushRef])

  // Reset hasReset when page changes
  useEffect(() => {
    void pageId
    setHasReset(false)
    setShowResetConfirm(false)
  }, [pageId])

  // Handle reset after malformed content
  const handleReset = (): void => {
    setShowResetConfirm(false)
    setHasReset(true)
    const defaultContent = JSON.stringify(createDefaultDocument())
    notifyEdit(defaultContent)
  }

  if (parseResult.status === 'error' && !hasReset) {
    return (
      <Stack gap="md" className={classes.editorRoot}>
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error" variant="light">
          <Text size="sm">{UI_TEXT.richEditorLoadError}</Text>
          <Text size="xs" c="dimmed" mt="xs">
            {parseResult.errorMessage}
          </Text>
          <Text size="xs" c="dimmed" mt="xs">
            {UI_TEXT.richEditorPreserveNotice}
          </Text>
        </Alert>

        <Text size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>
          {parseResult.originalValue.slice(0, 500)}
        </Text>

        {!showResetConfirm ? (
          <Button variant="light" color="red" onClick={() => setShowResetConfirm(true)}>
            {UI_TEXT.richEditorResetButton}
          </Button>
        ) : (
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              Are you sure? This will replace the stored content with an empty document.
            </Text>
            <Button color="red" onClick={handleReset}>
              Confirm reset
            </Button>
            <Button variant="subtle" onClick={() => setShowResetConfirm(false)}>
              {UI_TEXT.cancelButton}
            </Button>
          </Stack>
        )}

        {status === 'error' ? (
          <Alert color="red" variant="light" title={UI_TEXT.saveStatusError}>
            {error ?? UI_TEXT.saveStatusError}
            <Button
              size="xs"
              ml="sm"
              onClick={async () => {
                await retry()
              }}
            >
              {UI_TEXT.saveStatusRetry}
            </Button>
          </Alert>
        ) : null}
      </Stack>
    )
  }

  const initialDocument = hasReset
    ? createDefaultDocument()
    : (parseResult.document ?? createDefaultDocument())

  return (
    <div className={classes.editorRoot} data-testid="rich-editor">
      <RichEditorInner
        key={pageId}
        pageId={pageId}
        initialDocument={initialDocument}
        notifyEdit={notifyEdit}
        status={status}
        error={error}
      />
    </div>
  )
}

interface InnerProps {
  pageId: string
  initialDocument: ReturnType<typeof createDefaultDocument>
  notifyEdit: (content: string) => void
  status: AutosaveStatus
  error: string | null
}

function RichEditorInner({
  pageId,
  initialDocument,
  notifyEdit,
  status,
  error
}: InnerProps): JSX.Element {
  const editor = useCreateBlockNote(
    {
      initialContent: initialDocument as PartialBlock[]
    },
    [pageId]
  )

  const blocknoteTheme = useComputedColorScheme('light')

  // Use useEditorChange for reliable change detection per official docs
  useEffect(() => {
    const subscription = editor.onChange(() => {
      const content = JSON.stringify(editor.document)
      notifyEdit(content)
    })
    return () => {
      subscription()
    }
  }, [editor, notifyEdit])

  return (
    <Stack gap="xs" className={classes.editorContainer}>
      {status === 'error' ? (
        <Alert color="red" variant="light" title={UI_TEXT.saveStatusError}>
          <Text size="sm">{error ?? UI_TEXT.saveFailedRetryHint}</Text>
        </Alert>
      ) : null}

      <div className={classes.toolbarArea} role="toolbar" aria-label="Permanent formatting toolbar">
        <FormattingToolbar />
      </div>

      <div className={classes.blockNoteWrapper}>
        <BlockNoteView editor={editor} theme={blocknoteTheme} />
      </div>

      <Text size="xs" c="dimmed">
        {UI_TEXT.abruptExitNotice}
      </Text>
    </Stack>
  )
}

// Re-export for testing
export { serializeDocument } from './document.js'
