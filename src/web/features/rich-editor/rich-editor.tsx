import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import '@blocknote/mantine/style.css'
import { Alert, Button, Stack, Text } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { updatePage } from '../../services/pages-api.js'
import { createDefaultDocument, parseStoredDocument, serializeDocument } from './document.js'
import classes from './rich-editor.module.css'
import { useAutosave } from './use-autosave.js'

interface RichEditorProps {
  pageId: string
  storedContent: string
  pageTitle: string
  onFlushRef?: (fn: (() => Promise<boolean>) | null) => void
}

export function RichEditor({
  pageId,
  storedContent,
  pageTitle,
  onFlushRef
}: RichEditorProps): JSX.Element {
  const parseResult = parseStoredDocument(storedContent)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [hasReset, setHasReset] = useState(false)
  const [documentResetKey, setDocumentResetKey] = useState(0)

  const handleSave = async (pid: string, content: string): Promise<void> => {
    await updatePage(pid, { content })
  }

  const { status, error, notifyEdit, retry, flush } = useAutosave({ pageId, onSave: handleSave })

  useEffect(() => {
    if (onFlushRef) onFlushRef(flush)
    return () => {
      if (onFlushRef) onFlushRef(null)
    }
  }, [flush, onFlushRef])

  // Reset hasReset when page changes
  useEffect(() => {
    setHasReset(false)
    setShowResetConfirm(false)
    setDocumentResetKey(0)
  }, [pageId, storedContent])

  // Handle reset after malformed content
  const handleReset = (): void => {
    setShowResetConfirm(false)
    setHasReset(true)
    setDocumentResetKey((k) => k + 1)
    // Save the default document immediately
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
            <Button size="xs" ml="sm" onClick={retry}>
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
        key={`${pageId}-${documentResetKey}`}
        pageId={pageId}
        initialDocument={initialDocument}
        notifyEdit={notifyEdit}
        status={status}
        error={error}
        onRetry={retry}
        pageTitle={pageTitle}
      />
    </div>
  )
}

interface InnerProps {
  pageId: string
  initialDocument: ReturnType<typeof createDefaultDocument>
  notifyEdit: (content: string) => void
  status: ReturnType<typeof useAutosave>['status']
  error: string | null
  onRetry: () => void
  pageTitle: string
}

function RichEditorInner({
  initialDocument,
  notifyEdit,
  status,
  error,
  onRetry
}: InnerProps): JSX.Element {
  const editor = useCreateBlockNote({
    initialContent: initialDocument as never
  })

  // Expose flush for page switching via window event? Parent will handle via ref?
  // For now, notifyEdit on change
  useEffect(() => {
    // Ensure editor is available
    if (!editor) return
    // No additional setup needed
  }, [editor])

  return (
    <Stack gap="xs" className={classes.editorContainer}>
      {status === 'error' ? (
        <Alert color="red" variant="light" title={UI_TEXT.saveStatusError}>
          <Text size="sm">{error ?? UI_TEXT.saveFailedRetryHint}</Text>
          <Button size="xs" ml="sm" onClick={onRetry}>
            {UI_TEXT.saveStatusRetry}
          </Button>
        </Alert>
      ) : null}

      {status === 'saving' ? (
        <Text size="xs" c="dimmed">
          {UI_TEXT.saveStatusSaving}
        </Text>
      ) : null}

      {status === 'saved' ? (
        <Text size="xs" c="dimmed">
          {UI_TEXT.saveStatusSaved}
        </Text>
      ) : null}

      <div className={classes.blockNoteWrapper}>
        <BlockNoteView
          editor={editor}
          theme="light"
          onChange={() => {
            const content = JSON.stringify(editor.document)
            notifyEdit(content)
          }}
        />
      </div>

      <Text size="xs" c="dimmed">
        {UI_TEXT.abruptExitNotice}
      </Text>
    </Stack>
  )
}

// Re-export for testing
export { serializeDocument }
