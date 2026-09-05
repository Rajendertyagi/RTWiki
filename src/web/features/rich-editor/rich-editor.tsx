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
import { useMediaQueryBelow } from '../../hooks/use-media-query.js'
import { PaneDivider } from '../../layout/pane-divider.js'
import { updatePage } from '../../services/pages-api.js'
import { RightSidebar } from '../workspace/right-sidebar.js'
import { loadLayoutPreferences, saveLayoutPreferences } from '../workspace/layout-preferences.js'
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
import { RTSideMenu } from './side-menu.js'
import { RTSuggestionMenu, RTWikiLinkMenu } from './slash-menu.js'
import { useAutosave } from './use-autosave.js'
import type { LinkablePage } from './wiki-link.js'

/**
 * Temporary responsive collapse (Slice 2, Option B): at or below this
 * viewport width the right sidebar hides so the named minimums always fit.
 * Derived from LAYOUT — never a fixed breakpoint. The tree-pane minimum is
 * the full navbar width (the AppShell navbar contains the rail plus the
 * tree, so treePaneMinWidth already includes the rail and it must not be
 * added again). Session-only: never persisted; the saved explicit choice is
 * restored automatically when space returns. (Currently 919px.)
 */
const TEMP_COLLAPSE_MAX_WIDTH_PX =
  LAYOUT.treePaneMinWidth + LAYOUT.workspaceMinWidth + LAYOUT.rightSidebarMinWidth - 1

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

        <Text size="sm" c="dimmed" className={classes.parseDump}>
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
  // Right-sidebar geometry (Slice 2): the explicit width/collapse are the
  // user's persisted preference; the temporary narrow-window collapse is
  // derived from the viewport and never persisted. Effective visibility is
  // explicit OR temporary; the saved explicit choice restores automatically
  // when space returns.
  const [sidebarWidth, setSidebarWidth] = useState(() => loadLayoutPreferences().rightSidebarWidth)
  const [explicitCollapsed, setExplicitCollapsed] = useState(
    () => loadLayoutPreferences().rightSidebarCollapsed
  )
  const narrowCollapse = useMediaQueryBelow(TEMP_COLLAPSE_MAX_WIDTH_PX)
  // Session-only restore of a temporarily collapsed sidebar: shows the
  // sidebar for the current narrow-window state without reading or writing
  // the saved preference. Dropped as soon as the viewport leaves the narrow
  // state so the derived rule governs fresh afterwards.
  const [narrowOverride, setNarrowOverride] = useState(false)
  useEffect(() => {
    if (!narrowCollapse) setNarrowOverride(false)
  }, [narrowCollapse])
  const sidebarCollapsed = explicitCollapsed || (narrowCollapse && !narrowOverride)

  const persistSidebarPrefs = (patch: {
    rightSidebarWidth?: number
    rightSidebarCollapsed?: boolean
  }): void => {
    saveLayoutPreferences({ ...loadLayoutPreferences(), ...patch })
  }

  const handleSidebarCollapse = (): void => {
    setExplicitCollapsed(true)
    persistSidebarPrefs({ rightSidebarCollapsed: true })
  }

  const handleSidebarExpand = (): void => {
    // Explicit collapse control: clears the saved choice. A temporary
    // collapse instead restores visibility for the current narrow-window
    // state only and never changes or persists rightSidebarCollapsed.
    if (explicitCollapsed) {
      setExplicitCollapsed(false)
      persistSidebarPrefs({ rightSidebarCollapsed: false })
    } else {
      setNarrowOverride(true)
    }
  }

  const handleSidebarWidthCommit = (width: number): void => {
    persistSidebarPrefs({ rightSidebarWidth: width })
  }

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
          </div>

          <Text size="xs" c="dimmed">
            {UI_TEXT.abruptExitNotice}
          </Text>
        </Stack>

        {sidebarCollapsed ? (
          <Tooltip
            label={explicitCollapsed ? UI_TEXT.rightSidebarLabel : UI_TEXT.restoreSidebarLabel}
            position="left"
          >
            <button
              type="button"
              className={classes.sidebarExpand}
              aria-label={
                explicitCollapsed ? UI_TEXT.rightSidebarLabel : UI_TEXT.restoreSidebarLabel
              }
              onClick={handleSidebarExpand}
            >
              <IconLayoutSidebar size={16} />
            </button>
          </Tooltip>
        ) : (
          <>
            <PaneDivider
              value={sidebarWidth}
              min={LAYOUT.rightSidebarMinWidth}
              max={LAYOUT.rightSidebarMaxWidth}
              direction={-1}
              onChange={setSidebarWidth}
              onCommit={handleSidebarWidthCommit}
              ariaLabel={UI_TEXT.resizeSidebarLabel}
              testId="sidebar-divider"
            />
            <RightSidebar
              key={pageId}
              width={sidebarWidth}
              outline={outline}
              pageTypeLabel={UI_TEXT.richNote}
              createdDate={createdDate ?? ''}
              updatedDate={updatedDate ?? ''}
              pageId={pageId}
              onNavigateToHeading={navigateToHeading}
              onOpenPage={onOpenPage}
              onCollapse={handleSidebarCollapse}
            />
          </>
        )}
      </div>
    </div>
  )
}

// Re-export for testing
export { serializeDocument } from './document.js'
