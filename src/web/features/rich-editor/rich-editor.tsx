import { en } from '@blocknote/core/locales'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { useComputedColorScheme } from '@mantine/core'
import type { AutosaveStatus } from './autosave-controller.js'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { Alert, Button, Stack, Text, Tooltip } from '@mantine/core'
import { IconAlertCircle, IconLayoutSidebar } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { reportClientError } from '../../diagnostics/error-reporter.js'
import { updatePage } from '../../services/pages-api.js'
import { RightSidebar } from '../workspace/right-sidebar.js'
import {
  containUnknownBlocks,
  createDefaultDocument,
  type DocumentOutlineEntry,
  extractOutline,
  parseStoredDocument
} from './document.js'
import { EditorErrorBoundary } from './editor-error-boundary.js'
import classes from './rich-editor.module.css'
import { RichToolbar } from './rich-toolbar.js'
import {
  type AnyRichEditor,
  KNOWN_BLOCK_TYPES,
  type RTWikiPartialBlock,
  rtwikiBlockSchema
} from './schema.js'
import { RTSuggestionMenu } from './slash-menu.js'
import { useAutosave } from './use-autosave.js'

interface RichEditorProps {
  pageId: string
  storedContent: string
  pageTitle: string
  createdDate?: string
  updatedDate?: string
  /** Persists content; when provided it also syncs the pages list. */
  onSaveContent?: (id: string, content: string) => Promise<boolean>
  /** Returns to the pages dashboard from recovery UIs. */
  onBack?: () => void
  onFlushRef?: (fn: (() => Promise<boolean>) | null) => void
  onSaveStateChange?: (state: {
    isDirty: boolean
    saveState: 'clean' | 'saving' | 'saved' | 'error'
  }) => void
  /** Hands the live editor instance to the parent once initialized. */
  onEditorReady?: (editor: AnyRichEditor | null) => void
  /** Renders without the built-in toolbar; the parent hosts it externally. */
  toolbarExternal?: boolean
}

export function RichEditor({
  pageId,
  storedContent,
  createdDate,
  updatedDate,
  onSaveContent,
  onBack,
  onFlushRef,
  onSaveStateChange,
  onEditorReady,
  toolbarExternal
}: RichEditorProps): JSX.Element {
  const parseResult = parseStoredDocument(storedContent)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [hasReset, setHasReset] = useState(false)
  const [resetSeq, setResetSeq] = useState(0)

  const handleSave = async (pid: string, content: string): Promise<void> => {
    if (onSaveContent) {
      const ok = await onSaveContent(pid, content)
      if (!ok) throw new Error('Failed to save')
      return
    }
    await updatePage(pid, { content })
  }

  const { status, error, isDirty, notifyEdit, retry, flush } = useAutosave({
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

  // Report malformed stored content once per page (reporter dedupes repeats).
  useEffect(() => {
    if (parseResult.status === 'error' && !hasReset) {
      reportClientError('rich_note_parse_error', {
        pageType: 'rich',
        component: `RichEditor.parse:${pageId}`
      })
    }
  }, [parseResult.status, hasReset, pageId])

  // Report autosave failures once per error episode (reporter dedupes repeats).
  useEffect(() => {
    if (status === 'error') {
      reportClientError('rich_note_save_error', {
        pageType: 'rich',
        component: `RichEditor.autosave:${pageId}`
      })
    }
  }, [status, pageId])

  // Handle reset after malformed content or a contained editor failure.
  const handleReset = (): void => {
    setShowResetConfirm(false)
    setHasReset(true)
    setResetSeq((seq) => seq + 1)
    notifyEdit(JSON.stringify(createDefaultDocument()))
  }

  // Retry remounts the editor with the same stored content — nothing is wiped.
  const handleRetry = (): void => {
    setResetSeq((seq) => seq + 1)
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
    : containUnknownBlocks(parseResult.document ?? createDefaultDocument(), KNOWN_BLOCK_TYPES)

  return (
    <div className={classes.editorRoot} data-testid="rich-editor">
      <EditorErrorBoundary onReset={handleReset} onRetry={handleRetry} onBack={onBack}>
        <RichEditorInner
          key={`${pageId}-${resetSeq}`}
          pageId={pageId}
          initialDocument={initialDocument}
          notifyEdit={notifyEdit}
          status={status}
          error={error}
          createdDate={createdDate}
          updatedDate={updatedDate}
          onEditorReady={onEditorReady}
          toolbarExternal={toolbarExternal}
        />
      </EditorErrorBoundary>
    </div>
  )
}

interface InnerProps {
  pageId: string
  initialDocument: ReturnType<typeof createDefaultDocument>
  notifyEdit: (content: string) => void
  status: AutosaveStatus
  error: string | null
  createdDate?: string
  updatedDate?: string
  /** Hands the live editor instance to the parent once initialized. */
  onEditorReady?: (editor: AnyRichEditor | null) => void
  /** Renders without the built-in toolbar; the parent hosts it externally. */
  toolbarExternal?: boolean
}

function RichEditorInner(props: InnerProps): JSX.Element {
  const {
    pageId,
    initialDocument,
    notifyEdit,
    status,
    error,
    createdDate,
    updatedDate,
    onEditorReady,
    toolbarExternal
  } = props
  const editor = useCreateBlockNote(
    {
      schema: rtwikiBlockSchema,
      initialContent: initialDocument as unknown as RTWikiPartialBlock[],
      dictionary: {
        ...en,
        placeholders: {
          ...en.placeholders,
          paragraph: UI_TEXT.richPlaceholder
        }
      }
    },
    [pageId]
  )

  const blocknoteTheme = useComputedColorScheme('light')
  const [outline, setOutline] = useState<DocumentOutlineEntry[]>(() =>
    extractOutline(initialDocument)
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Hand the live editor instance to the parent so an externally hosted
  // toolbar can bind to it; cleared on unmount/editor replacement.
  // The parent passes a stable setState function, so this re-runs only
  // when the editor instance itself is replaced.
  useEffect(() => {
    onEditorReady?.(editor)
    return () => onEditorReady?.(null)
  }, [editor, onEditorReady])

  // Place the caret in the document on open and keep claiming focus briefly:
  // Mantine's Modal restores focus to its trigger after the create dialog
  // closes, which can land after a single immediate focus call. The grace
  // window reclaims focus from non-input targets only, so deliberate focus
  // moves (search box, tree navigation) are respected.
  useEffect(() => {
    let cancelled = false
    const startedAt = Date.now()
    const tick = (): void => {
      if (cancelled) return
      const editorEl = document.querySelector('.bn-editor')
      const active = document.activeElement as HTMLElement | null
      const editorHasFocus = editorEl !== null && active !== null && editorEl.contains(active)
      const focusOnOtherInput =
        active !== null &&
        (active.closest('input, textarea, [contenteditable="true"], [role="tree"]') !== null ||
          active === editorEl)
      if (editorEl && !editorHasFocus && !focusOnOtherInput) {
        const blocks = editor.document
        const last = blocks[blocks.length - 1]
        if (last) editor.setTextCursorPosition(last.id, 'end')
        editor.focus()
      }
      if (!editorHasFocus && Date.now() - startedAt < 1200) {
        setTimeout(tick, 100)
      }
    }
    tick()
    return () => {
      cancelled = true
    }
  }, [editor])

  useEffect(() => {
    const subscription = editor.onChange(() => {
      const content = JSON.stringify(editor.document)
      notifyEdit(content)
      setOutline(extractOutline(editor.document))
    })
    return () => {
      subscription()
    }
  }, [editor, notifyEdit])

  const navigateToHeading = (blockId: string): void => {
    editor.setTextCursorPosition(blockId, 'start')
    editor.focus()
  }

  return (
    <div className={classes.richColumn}>
      {status === 'error' ? (
        <Alert color="red" variant="light" title={UI_TEXT.saveStatusError}>
          <Text size="sm">{error ?? UI_TEXT.saveFailedRetryHint}</Text>
        </Alert>
      ) : null}

      {toolbarExternal ? null : <RichToolbar editor={editor} />}

      <div className={classes.richRow}>
        <Stack gap="xs" className={classes.editorContainer}>
          <div className={classes.blockNoteWrapper}>
            <BlockNoteView editor={editor} theme={blocknoteTheme} formattingToolbar={false}>
              <RTSuggestionMenu editor={editor} />
            </BlockNoteView>
          </div>

          <Text size="xs" c="dimmed">
            {UI_TEXT.abruptExitNotice}
          </Text>
        </Stack>

        {sidebarCollapsed ? (
          <Tooltip label={UI_TEXT.rightSidebarLabel} position="left">
            <button
              type="button"
              className={classes.sidebarExpand}
              aria-label={UI_TEXT.rightSidebarLabel}
              onClick={() => setSidebarCollapsed(false)}
            >
              <IconLayoutSidebar size={16} />
            </button>
          </Tooltip>
        ) : (
          <RightSidebar
            outline={outline}
            pageTypeLabel={UI_TEXT.richNote}
            createdDate={createdDate ?? ''}
            updatedDate={updatedDate ?? ''}
            onNavigateToHeading={navigateToHeading}
            onCollapse={() => setSidebarCollapsed(true)}
          />
        )}
      </div>
    </div>
  )
}

// Re-export for testing
export { serializeDocument } from './document.js'
