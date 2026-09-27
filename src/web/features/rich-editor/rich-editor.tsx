import { en } from '@blocknote/core/locales'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { useComputedColorScheme } from '@mantine/core'
import type { AutosaveStatus } from './autosave-controller.js'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { Alert, Button, Stack, Text, Tooltip } from '@mantine/core'
import { parseInternalLinkHref } from '@rtwiki/shared/schemas/page-links'
import { IconAlertCircle, IconLayoutSidebar } from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LAYOUT, UI_TEXT } from '../../config/index.js'
import { reportClientError } from '../../diagnostics/error-reporter.js'
import { updatePage } from '../../services/pages-api.js'
import { richBlocksPlainText } from '../../util/page-preview-text.js'
import { useEditorPreferences } from '../workspace/editor-preferences.js'
import { RightSidebarRegion } from '../workspace/right-sidebar-region.js'
import type { StatusSaveState } from '../workspace/save-state.js'
import { mapAutosaveStatus } from '../workspace/save-state.js'
import { LinkedPageContext, type LinkedPageContextValue } from './blocks/linked-page-block.js'
import { uploadAttachment } from './blocks/upload-attachment.js'
import {
  containUnknownBlocks,
  createDefaultDocument,
  type DocumentOutlineEntry,
  extractOutline,
  parseStoredDocument
} from './document.js'
import { EditorErrorBoundary, ResetConfirmation } from './editor-error-boundary.js'
import classes from './rich-editor.module.css'
import { RichToolbar } from './rich-toolbar.js'
import {
  type AnyRichEditor,
  KNOWN_BLOCK_TYPES,
  type RTWikiPartialBlock,
  rtwikiBlockSchema
} from './schema.js'
import { RTSideMenu } from './side-menu.js'
import { RTSuggestionMenu, RTWikiLinkMenu } from './slash-menu.js'
import {
  createSpellcheckExtensionFactory,
  createSpellcheckHolder
} from './spell/spellcheck-extension.js'
import { useSpellcheck } from './spell/use-spellcheck.js'
import { useAutosave } from './use-autosave.js'
import type { LinkablePage } from './wiki-link.js'

/**
 * Word count over a BlockNote document.
 *
 * **Aligned deliberately with the dashboard preview and the status bar.** This
 * used to be a third convention: it read only top-level blocks' inline content,
 * so a word typed in a sub-list or a table cell counted here but not in the
 * status bar for the same page — one document, two different numbers, both on
 * screen. An undocumented third behaviour is worse than a slightly slower one,
 * so this now calls the same reduction `pagePlainText` uses.
 *
 * The cost was measured rather than assumed, because this runs on every change.
 * Per call, against the top-level-only version it replaced:
 *
 * | Document                          | was  | now   |
 * |-----------------------------------|------|-------|
 * | 150 blocks (19 kB)                | 0.02 | 0.08  |
 * | 800 blocks (100 kB)               | 0.03 | 0.20  |
 * | 2,500 blocks (314 kB)             | 0.20 | 1.87  |
 * | 12,000 blocks (1.5 MB)            | 0.98 | 11.67 |
 *
 * (ms, Bun 1.4.2, 200 runs after warm-up.) Sub-millisecond for any realistic
 * study note. The worst row is a 1.5 MB document, and the same handler already
 * spends 5.1 ms there on `JSON.stringify(editor.document)` for autosave — the
 * walk is not what makes such a page slow, and it stays inside a 16 ms frame
 * until roughly 10,000 blocks, which is a document no person writes.
 */
function countBlockWords(document: ReadonlyArray<unknown>): number {
  const text = richBlocksPlainText(document)
  if (text.length === 0) return 0
  const matches = text.match(/\S+/g)
  return matches ? matches.length : 0
}

/**
 * Temporary responsive collapse (Slice 2, Option B): at or below this
 * viewport width the right sidebar hides so the named minimums always fit.
 * Derived from LAYOUT — never a fixed breakpoint. The tree-pane minimum is
 * the full navbar width (the AppShell navbar contains the rail plus the
 * tree, so treePaneMinWidth already includes the rail and it must not be
 * added again). Session-only: never persisted; the saved explicit choice is
 * restored automatically when space returns. (Currently 919px.)
 */
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
    saveState: StatusSaveState
    error?: string | null
  }) => void
  /** Hands the live editor instance to the parent once initialized. */
  onEditorReady?: (editor: AnyRichEditor | null) => void
  /** Renders without the built-in toolbar; the parent hosts it externally. */
  toolbarExternal?: boolean
  /** All living pages, for internal-link insertion and broken-link styling. */
  linkablePages?: LinkablePage[]
  /** Opens a page through the controller/tab flow (flushes pending edits). */
  onOpenPage?: (pageId: string) => void
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
  toolbarExternal,
  linkablePages = [],
  onOpenPage
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
      onSaveStateChange({
        isDirty,
        // Mapped, not cast. This used to cast `AutosaveStatus` straight to the
        // display type, so `'dirty'` reached the status bar as a value it does
        // not recognise and fell through to "Saved" - a Rich Note claimed to be
        // saved while the edit was still only in memory.
        saveState: mapAutosaveStatus(status),
        error: status === 'error' ? error : null
      })
    }
  }, [isDirty, status, error, onSaveStateChange])

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
  // The only place stored content is replaced. Both recovery screens route here,
  // and neither reaches it until the user has confirmed `ResetConfirmation` —
  // RTWiki keeps no backup copy, so an unconfirmed reset would be unrecoverable.
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
            {UI_TEXT.richEditorParseRecoveryNotice}
          </Text>
        </Alert>

        <Text size="sm" c="dimmed" className={classes.parseDump}>
          {parseResult.originalValue.slice(0, 500)}
        </Text>

        {!showResetConfirm ? (
          <Button
            variant="light"
            color="red"
            onClick={() => setShowResetConfirm(true)}
            data-testid="reset-request"
          >
            {UI_TEXT.richEditorResetButton}
          </Button>
        ) : (
          <ResetConfirmation onConfirm={handleReset} onCancel={() => setShowResetConfirm(false)} />
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
      {/* `onReset` is the same destructive action the malformed-content screen
          above guards, reached here only through the boundary's own
          `ResetConfirmation`. */}
      <EditorErrorBoundary onReset={handleReset} onRetry={handleRetry} onBack={onBack}>
        <RichEditorInner
          key={`${pageId}-${resetSeq}`}
          pageId={pageId}
          initialDocument={initialDocument}
          notifyEdit={notifyEdit}
          status={status}
          error={error}
          retry={retry}
          createdDate={createdDate}
          updatedDate={updatedDate}
          onEditorReady={onEditorReady}
          toolbarExternal={toolbarExternal}
          linkablePages={linkablePages}
          onOpenPage={onOpenPage}
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
  retry: () => Promise<boolean>
  createdDate?: string
  updatedDate?: string
  /** Hands the live editor instance to the parent once initialized. */
  onEditorReady?: (editor: AnyRichEditor | null) => void
  /** Renders without the built-in toolbar; the parent hosts it externally. */
  toolbarExternal?: boolean
  linkablePages?: LinkablePage[]
  onOpenPage?: (pageId: string) => void
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
    toolbarExternal,
    linkablePages = [],
    onOpenPage
  } = props
  // Stable across renders: it is read by a ProseMirror plugin that lives in the
  // editor state for the life of the page, so it must keep the same identity.
  const spellcheckHolderRef = useRef(createSpellcheckHolder())
  const spellcheckExtension = useMemo(
    () => createSpellcheckExtensionFactory(spellcheckHolderRef.current),
    []
  )

  const editor = useCreateBlockNote(
    {
      extensions: [spellcheckExtension],
      schema: rtwikiBlockSchema,
      // BlockNote routes the file picker, paste and drop through this one hook.
      // It dispatches on the browser's reported type purely to decide *which
      // uploader's failure message* the user should see; the server identifies
      // the file from its own bytes either way, so this cannot make an
      // unacceptable file acceptable.
      //
      // It has to dispatch rather than call one uploader: a single `uploadImage`
      // meant a dropped PDF was reported as "That image could not be added",
      // which is both wrong and unactionable. Two uploaders remain - the request
      // shape and the size check are shared by `uploadDocument` - so there is no
      // second request path to keep in step.
      //
      // The returned URL is what gets stored in the block, which keeps the
      // document canonical BlockNote JSON (ADR-004) with the attachment
      // catalogue - not the file - as the source of truth.
      uploadFile: uploadAttachment,
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
  // Spell check is a user preference and its personal dictionary belongs to the
  // reader, so both come from the versioned editor preference store rather than
  // being hard-coded here. The hook loads the dictionary into the holder the
  // extension's plugin reads; it never mutates the editor view.
  const editorPrefs = useEditorPreferences()
  useSpellcheck(
    editor,
    spellcheckHolderRef.current,
    editorPrefs.spellCheck,
    editorPrefs.personalWords
  )
  const [outline, setOutline] = useState<DocumentOutlineEntry[]>(() =>
    extractOutline(initialDocument)
  )
  const [, setWordCount] = useState(() => countBlockWords(initialDocument))

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
        (active.closest(
          // `role="tab"` belongs here for the same reason `role="tree"` already
          // does: both are deliberate keyboard focus targets. Without it, this
          // grace window stole focus from the tab strip for up to 1.2s after a
          // page opened, so reordering tabs with Ctrl+Arrow moved the tab and
          // then the caret jumped into the document. Buttons are deliberately
          // NOT listed: reclaiming focus from a button is the whole point of
          // this effect, since a Mantine Modal restores focus to its trigger.
          //
          // `role="dialog"` closes the gap that made that last rule dangerous.
          // A button is only reclaimable when it belongs to the page the user
          // came from; a button INSIDE an open dialog (Mantine renders the
          // modal content as `<section role="dialog">`) is a deliberate target
          // and this effect used to yank focus straight out of the dialog into
          // the document. Press Ctrl+K and type and the words landed in the
          // open note, not the search box. Reclaiming from the dialog's
          // trigger still works: Mantine's `useFocusReturn` moves focus back
          // out of the dialog ~10ms after it closes, so by the time this
          // effect sees the trigger the dialog is no longer an ancestor.
          'input, textarea, [contenteditable="true"], [role="tree"], [role="tab"], [role="tablist"], [role="dialog"]'
        ) !== null ||
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
      setWordCount(countBlockWords(editor.document))
    })
    return () => {
      subscription()
    }
  }, [editor, notifyEdit])

  // ---- Internal wiki links ------------------------------------------------
  const knownPageIds = useMemo(() => new Set(linkablePages.map((p) => p.id)), [linkablePages])
  const knownPageIdsRef = useRef(knownPageIds)
  knownPageIdsRef.current = knownPageIds
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [brokenLinkNotice, setBrokenLinkNotice] = useState(false)

  // Marks anchors whose target no longer exists. Pure DOM-level styling: the
  // underlying link mark keeps its stored ID, so repairing (recreating the
  // page) or removing the link stays a normal editing action.
  useEffect(() => {
    // Captured so this effect re-runs (and re-scans) when the page set changes.
    const known = knownPageIds
    const scan = (): void => {
      const wrapper = wrapperRef.current
      if (!wrapper) return
      const anchors = wrapper.querySelectorAll(
        'a[href^="#/page/"]'
      ) as NodeListOf<HTMLAnchorElement>
      for (const anchor of anchors) {
        const id = parseInternalLinkHref(anchor.getAttribute('href') ?? '')
        anchor.classList.toggle('rtwiki-broken-link', id === null || !known.has(id))
      }
    }
    scan()
    // Re-scan after edits (BN re-renders node views); debounced to once per
    // second so typing never pays for it.
    let timer: number | null = null
    const schedule = (): void => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        scan()
      }, 1000)
    }
    const unsub = editor.onChange(schedule)
    return () => {
      unsub()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [editor, knownPageIds])

  // Click interception: internal links navigate through the controller flow
  // (flush + tab dedupe, no browser navigation). Deleted targets show an
  // understandable notice and never navigate anywhere else. Attached via a
  // ref listener: the wrapper is a static container and must not grow an
  // interaction ARIA contract.
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const listener = (event: MouseEvent): void => {
      const target = event.target as HTMLElement
      const anchor = target.closest('a[href^="#/page/"]') as HTMLAnchorElement | null
      if (!anchor) return
      event.preventDefault()
      event.stopPropagation()
      const id = parseInternalLinkHref(anchor.getAttribute('href') ?? '')
      if (id === null) return
      if (knownPageIdsRef.current.has(id)) {
        setBrokenLinkNotice(false)
        onOpenPage?.(id)
      } else {
        setBrokenLinkNotice(true)
        window.setTimeout(() => setBrokenLinkNotice(false), 4000)
      }
    }
    wrapper.addEventListener('click', listener)
    return () => wrapper.removeEventListener('click', listener)
  }, [onOpenPage])

  const navigateToHeading = (blockId: string): void => {
    editor.setTextCursorPosition(blockId, 'start')
    editor.focus()
  }

  // Shared page-list + navigation context for linked-page blocks. Resolves a
  // target by ID and opens it through RTWiki's normal tab/nav flow.
  const linkedPageContextValue = useMemo<LinkedPageContextValue>(
    () => ({
      pages: linkablePages,
      resolvePage: (id) => {
        const page = linkablePages.find((candidate) => candidate.id === id)
        if (!page) return null
        return {
          id: page.id,
          title: page.title,
          pageType: page.pageType ?? 'rich',
          preview: page.preview ?? ''
        }
      },
      openPage: (id) => onOpenPage?.(id)
    }),
    [linkablePages, onOpenPage]
  )

  return (
    <div className={classes.richColumn}>
      {status === 'error' ? (
        <Alert color="red" variant="light" title={UI_TEXT.saveStatusError}>
          <Text size="sm">{error ?? UI_TEXT.saveFailedRetryHint}</Text>
        </Alert>
      ) : null}

      {brokenLinkNotice ? (
        <Alert color="orange" variant="light" role="status" data-testid="broken-link-notice">
          <Text size="sm">{UI_TEXT.brokenLinkNotice}</Text>
        </Alert>
      ) : null}

      {toolbarExternal ? null : <RichToolbar editor={editor} linkablePages={linkablePages} />}

      <div className={classes.richRow}>
        <Stack gap="xs" className={classes.editorContainer}>
          <div className={classes.blockNoteWrapper} ref={wrapperRef}>
            <LinkedPageContext.Provider value={linkedPageContextValue}>
              <BlockNoteView
                editor={editor}
                theme={blocknoteTheme}
                formattingToolbar={false}
                sideMenu={false}
              >
                {/* Custom side menu replaces the built-in controller (disabled
                    above) so exactly ONE drag-handle menu exists, carrying the
                    Move up / Move down actions. */}
                <RTSideMenu editor={editor} />
                <RTSuggestionMenu editor={editor} />
                {linkablePages.length > 0 ? (
                  <RTWikiLinkMenu editor={editor} pages={linkablePages} />
                ) : null}
              </BlockNoteView>
            </LinkedPageContext.Provider>
          </div>
        </Stack>

        <RightSidebarRegion
          pageId={pageId}
          outline={outline}
          pageTypeLabel={UI_TEXT.richNote}
          createdDate={createdDate ?? ''}
          updatedDate={updatedDate ?? ''}
          onNavigateToHeading={navigateToHeading}
          onOpenPage={onOpenPage}
        />
      </div>
    </div>
  )
}

// Re-export for testing
export { serializeDocument } from './document.js'
