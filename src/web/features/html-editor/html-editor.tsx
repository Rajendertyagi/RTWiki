import { Box, Button, Group, Stack, Switch, Text, Tooltip } from '@mantine/core'
import { PREVIEW_REBUILD_DEBOUNCE_MS } from '@rtwiki/shared/constants'
import {
  createEmptyHtmlContent,
  type HtmlPageContentV2,
  normalizeHtmlContent,
  parseHtmlContent,
  serializeHtmlContent
} from '@rtwiki/shared/schemas/html-content'
import { IconInfoCircle } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { createThrottledEmitter, debugLog, safeHash } from '../../diagnostics/debug-log.js'
import { PreviewFrame } from '../html/preview-frame.js'
import { useAutosave } from '../rich-editor/use-autosave.js'
import { CodeEditor } from './code-editor.js'
import { formatSource } from './format-source.js'
import classes from './html-editor.module.css'
import { SourceToolbar } from './source-toolbar.js'
import type { EditorStats } from './use-codemirror.js'

export interface HtmlEditorWorkspaceProps {
  pageId: string
  storedContent: string
  /** Active source subfile; null shows only the rendered preview. */
  sourceField: 'html' | 'css' | 'javascript' | null
  /** Returns from a source subfile to the rendered preview. */
  onExitSource?: () => void
  /** Persists editor content and syncs the pages list. */
  onSaveContent?: (id: string, content: string) => Promise<boolean>
  /** Returns to the pages dashboard from recovery UIs. */
  onBack?: () => void
  /** Display-only parent chain for the breadcrumb. */
  breadcrumbLabels?: string[]
  onFlushRef?: (fn: (() => Promise<boolean>) | null) => void
  onSaveStateChange?: (state: {
    isDirty: boolean
    saveState: 'clean' | 'saving' | 'saved' | 'error'
  }) => void
}

type ContentField = 'html' | 'css' | 'javascript'

const FIELD_LABELS: Record<ContentField, keyof typeof UI_TEXT> = {
  html: 'editorPaneLabelHtml',
  css: 'editorPaneLabelCss',
  javascript: 'editorPaneLabelJs'
}

/**
 * Editable HTML-page workspace. Two modes driven by sourceField:
 * - null: rendered preview only (the student view) with a Refresh action.
 * - html/css/javascript: a single CodeMirror editor for that field with an
 *   explicit return-to-preview action (the JavaScript subfile additionally
 *   hosts the preview JS gate).
 *
 * Draft contract: ONE in-memory draft per open page holding all v2 fields,
 * created exactly once per mount (the workspace keys this component by the
 * real parent page id). Server responses NEVER overwrite the draft — the
 * previous storedContent→draft reset effect was the rollback race that made
 * typing disappear after subfile switches; persistence reconciliation now
 * flows one way only (draft → autosave → server), and stale autosave
 * completions are rejected inside the autosave controller.
 */
export default function HtmlEditorWorkspace({
  pageId,
  storedContent,
  sourceField,
  onExitSource,
  onSaveContent,
  breadcrumbLabels = [],
  onFlushRef,
  onSaveStateChange
}: HtmlEditorWorkspaceProps): JSX.Element {
  const parseResult = useMemo(() => parseHtmlContent(storedContent), [storedContent])

  const [content, setContent] = useState<HtmlPageContentV2>(() =>
    parseResult.ok ? normalizeHtmlContent(parseResult.content) : createEmptyHtmlContent()
  )
  const [previewContent, setPreviewContent] = useState<HtmlPageContentV2>(content)

  // Monotonic draft generation: bumped by every local mutation. Debug Mode
  // correlates transactions and renders against it; no server snapshot can
  // ever rewind it because nothing writes back into `content` after mount.
  const generationRef = useRef(0)
  // Mirror of the newest draft for synchronous reads inside effects/handlers.
  const contentRef = useRef(content)
  contentRef.current = content

  // Debug Mode: editor lifecycle. The draft is created exactly once per
  // mounted page; its identity is the real parent page id.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-scoped lifecycle observation; content changes are never re-logged here
  useEffect(() => {
    debugLog('editor', 'editor_mount', { pageId, field: sourceField ?? 'preview' })
    debugLog('editor', 'editor_draft_created', {
      pageId,
      len: content.html.length + content.css.length + content.javascript.length,
      hash: safeHash(content.html + content.css + content.javascript)
    })
    return () => {
      debugLog('editor', 'editor_unmount', { pageId })
    }
  }, [pageId])

  const handleSave = useCallback(
    async (pid: string, serialized: string): Promise<void> => {
      if (!onSaveContent) {
        return
      }
      const ok = await onSaveContent(pid, serialized)
      if (!ok) {
        throw new Error('Failed to save')
      }
    },
    [onSaveContent]
  )

  // The autosave hook is content-agnostic: it persists whatever string we
  // hand it — here always canonical v2 JSON.
  const { status, error, notifyEdit, save, retry, flush } = useAutosave({
    pageId,
    onSave: handleSave
  })

  useEffect(() => {
    if (onSaveStateChange) {
      // Map the autosave lifecycle onto the header's display states: a dirty
      // page simply hasn't started saving yet, so it presents as clean there
      // while isDirty carries the real signal.
      const saveState =
        status === 'saving'
          ? ('saving' as const)
          : status === 'saved'
            ? ('saved' as const)
            : status === 'error'
              ? ('error' as const)
              : ('clean' as const)
      onSaveStateChange({ isDirty: status !== 'idle' && status !== 'saved', saveState })
    }
  }, [status, onSaveStateChange])

  useEffect(() => {
    if (onFlushRef) {
      onFlushRef(flush)
    }
    return () => {
      if (onFlushRef) {
        onFlushRef(null)
      }
    }
  }, [flush, onFlushRef])

  // NOTE: there is deliberately NO storedContent→draft reset effect here.
  // The workspace remounts this component per page (key = page id), so a
  // genuine page switch rebuilds the draft from persisted content at mount.
  // Re-applying server snapshots while mounted was the rollback race that
  // reverted newer typing whenever an autosave response landed (defects 1-3);
  // the draft is now write-only from the editor's perspective.

  // Debug Mode: source-field switches (requested/completed in one commit —
  // the switch is synchronous state, so both observations carry the same tick).
  const previousFieldRef = useRef(sourceField)
  useEffect(() => {
    if (previousFieldRef.current === sourceField) return
    const returningToPreview = previousFieldRef.current !== null && sourceField === null
    previousFieldRef.current = sourceField
    debugLog('editor', 'editor_source_switch_requested', {
      pageId,
      field: sourceField ?? 'preview'
    })
    if (returningToPreview) {
      // Commit the newest draft into the preview SYNCHRONOUSLY: the rendered
      // parent must reflect exactly what the user just typed, without waiting
      // for the debounce or for autosave to finish in the background.
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current)
        previewTimerRef.current = null
      }
      setPreviewContent(contentRef.current)
    }
    debugLog('editor', 'editor_source_switch_completed', {
      pageId,
      field: sourceField ?? 'preview'
    })
  }, [sourceField, pageId])

  // Debug Mode: throttled transaction observation (latest keystroke stats at
  // most once per second; length, safe hash and draft generation only).
  const emitTransaction = useMemo(
    () =>
      createThrottledEmitter(1000, (field: ContentField, value: string, gen: number) => {
        debugLog('editor', 'editor_transaction', {
          pageId,
          field,
          gen,
          len: value.length,
          hash: safeHash(value)
        })
      }),
    [pageId]
  )

  // Serialize-and-notify on every actual change. The guard keeps this
  // idempotent under StrictMode double-invocation and prevents marking the
  // page dirty on mount.
  const lastSerializedRef = useRef(serializeHtmlContent(content))
  useEffect(() => {
    const serialized = serializeHtmlContent(content)
    if (serialized === lastSerializedRef.current) {
      return
    }
    lastSerializedRef.current = serialized
    notifyEdit(serialized)
  }, [content, notifyEdit])

  // Debounced live-preview rebuild — one centralized constant, never per
  // keystroke. Every rebuild regenerates the channel ID inside PreviewFrame.
  const previewTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current)
    }
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null
      debugLog('preview', 'preview_render_requested', {
        pageId,
        len: content.html.length + content.css.length + content.javascript.length,
        hash: safeHash(content.html + content.css + content.javascript)
      })
      setPreviewContent(content)
    }, PREVIEW_REBUILD_DEBOUNCE_MS)
    return () => {
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current)
        previewTimerRef.current = null
      }
    }
  }, [content, pageId])

  const updateField = useCallback(
    (field: ContentField, value: string): void => {
      generationRef.current += 1
      setContent((prev) => ({ ...prev, [field]: value }))
      emitTransaction(field, value, generationRef.current)
    },
    [emitTransaction]
  )

  const toggleJs = useCallback((): void => {
    generationRef.current += 1
    setContent((prev) => ({ ...prev, jsEnabled: !prev.jsEnabled }))
  }, [])

  // Manual Refresh Preview: rebuilds the sandboxed iframe from the CURRENT
  // draft by regenerating the frame key (new channel ID, fresh document).
  // This is an explicit user action, never a workaround — the automatic
  // return-to-preview path commits the draft synchronously on its own.
  const [previewNonce, setPreviewNonce] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const refreshTimerRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
    }
  }, [])
  const handleRefreshPreview = useCallback((): void => {
    generationRef.current += 1
    setPreviewContent(contentRef.current)
    setPreviewNonce((n) => n + 1)
    setRefreshing(true)
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
    // Accessible completion: cleared when the frame reports ready (below) or
    // after a bounded fallback so the status can never stick.
    refreshTimerRef.current = window.setTimeout(() => setRefreshing(false), 2000)
    debugLog('preview', 'preview_manual_refresh', { pageId, gen: generationRef.current })
  }, [pageId])
  const handleFrameReady = useCallback((): void => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    setRefreshing(false)
  }, [])

  const manualSave = useCallback((): boolean => {
    void save()
    return true
  }, [save])

  const modSaveKeys = useMemo(() => [{ key: 'Mod-s', run: manualSave }], [manualSave])

  // ---- IDE state: toolbar-controlled editor presentation -----------------
  const [wordWrap, setWordWrap] = useState(true)
  const [fontSize, setFontSize] = useState(14)
  const [fullscreen, setFullscreen] = useState(false)
  const [stats, setStats] = useState<EditorStats>({ line: 1, column: 1, selectedChars: 0 })
  const [formatError, setFormatError] = useState<string | null>(null)
  const getViewRef = useRef<(() => import('@codemirror/view').EditorView | null) | null>(null)

  // Format Document: lazily loads Prettier standalone, formats the CURRENT
  // view document and dispatches the result as an ordinary transaction — so
  // it participates in undo history, flows through onChange → autosave, and
  // can never bypass the draft contract. Failures stay contained in the
  // status row; the source is never replaced by an empty result.
  const handleFormat = useCallback(async (): Promise<void> => {
    const view = getViewRef.current?.()
    if (!view || sourceField === null) return
    const result = await formatSource(sourceField, view.state.doc.toString())
    if (!result.ok) {
      setFormatError(result.error)
      debugLog('editor', 'editor_format_failed', { pageId, field: sourceField })
      return
    }
    setFormatError(null)
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: result.formatted },
      userEvent: 'input.format'
    })
    debugLog('editor', 'editor_format_applied', {
      pageId,
      field: sourceField,
      len: result.formatted.length
    })
  }, [pageId, sourceField])

  // Keyboard shortcuts (Shift+Alt+F format, F11 full-screen) attach to the
  // source view container via a ref listener so the static wrapper element
  // carries no interaction ARIA contract.
  const sourceViewRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const host = sourceViewRef.current
    if (!host) return
    const listener = (event: KeyboardEvent): void => {
      if (event.shiftKey && event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        void handleFormat()
        return
      }
      if (event.key === 'F11') {
        event.preventDefault()
        setFullscreen((f) => !f)
      }
    }
    host.addEventListener('keydown', listener)
    return () => host.removeEventListener('keydown', listener)
  }, [handleFormat])

  if (!parseResult.ok) {
    return (
      <Stack gap="md" p="md" data-testid="html-editor">
        <Text size="sm" c="red">
          {UI_TEXT.htmlEditorLoadError}
        </Text>
        <Text size="xs" c="dimmed">
          {UI_TEXT.htmlPreviewPreservedNotice}
        </Text>
      </Stack>
    )
  }

  // Rendered parent view ("student view"): the finished page plus minimal
  // page-level actions (Refresh preview). No source panes, no JS gate, no
  // sandbox explanation — those live in the JavaScript subfile. An empty
  // page shows a simple empty state instead of an empty sandbox frame.
  if (sourceField === null) {
    const isEmpty =
      content.html.trim() === '' && content.css.trim() === '' && content.javascript.trim() === ''
    return (
      <div className={classes.root} data-testid="html-preview-view">
        <Group justify="flex-end" gap="sm" className={classes.controls}>
          {refreshing ? (
            <Text size="xs" c="dimmed" role="status" data-testid="preview-refresh-status">
              {UI_TEXT.previewRefreshingLabel}
            </Text>
          ) : null}
          <Button
            size="compact-xs"
            variant="light"
            onClick={handleRefreshPreview}
            aria-label={UI_TEXT.refreshPreviewLabel}
            data-testid="refresh-preview"
          >
            {UI_TEXT.refreshPreviewLabel}
          </Button>
        </Group>
        {isEmpty ? (
          <Stack align="center" justify="center" gap="xs" className={classes.previewPane}>
            <Text c="dimmed">{UI_TEXT.htmlPreviewEmpty}</Text>
          </Stack>
        ) : (
          <Box className={classes.previewPaneFull} data-testid="live-preview">
            {/* Key = render generation: every refresh rebuilds the frame. */}
            <PreviewFrame key={previewNonce} content={previewContent} onReady={handleFrameReady} />
          </Box>
        )}
      </div>
    )
  }

  // Source subfile view: an IDE-style workspace — breadcrumb, source
  // toolbar, large editor area and a compact status row. The preview-JS gate
  // lives ONLY in the JavaScript subfile.
  const fieldLabel = UI_TEXT[FIELD_LABELS[sourceField]]
  const breadcrumbText = [...breadcrumbLabels, fieldLabel].join(' / ')
  const saveStateLabel =
    status === 'error'
      ? UI_TEXT.saveStatusError
      : status === 'saving'
        ? UI_TEXT.saveStatusSaving
        : status === 'saved'
          ? UI_TEXT.saveStatusSaved
          : ''
  return (
    <div
      ref={sourceViewRef}
      className={`${classes.root} ${fullscreen ? classes.sourceFullscreen : ''}`}
      data-testid="html-source-view"
      data-fullscreen={fullscreen ? 'true' : 'false'}
    >
      <Group justify="space-between" wrap="nowrap" gap="sm" className={classes.controls}>
        <Text size="xs" c="dimmed" data-testid="source-breadcrumb">
          {breadcrumbText}
        </Text>
        <Group gap="sm" wrap="nowrap">
          {sourceField === 'javascript' ? (
            <>
              <Switch
                checked={content.jsEnabled}
                onChange={toggleJs}
                label={UI_TEXT.jsEnabledToggleLabel}
                aria-label={UI_TEXT.jsEnabledToggleLabel}
                data-testid="js-enabled-toggle"
              />
              <Tooltip
                label={UI_TEXT.jsSandboxHint}
                position="bottom-end"
                withArrow
                multiline
                w={260}
              >
                <IconInfoCircle size={16} aria-label={UI_TEXT.jsSandboxHint} />
              </Tooltip>
            </>
          ) : null}
          <Button
            size="compact-xs"
            variant="light"
            onClick={() => {
              debugLog('ui', 'ui_return_to_preview', { pageId, field: sourceField })
              onExitSource?.()
            }}
            data-testid="return-to-preview-button"
          >
            {UI_TEXT.htmlSourceBackToPreview}
          </Button>
        </Group>
      </Group>

      <SourceToolbar
        getView={() => getViewRef.current?.() ?? null}
        onFormat={() => void handleFormat()}
        wordWrap={wordWrap}
        onToggleWordWrap={() => setWordWrap((w) => !w)}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        fullscreen={fullscreen}
        onToggleFullscreen={() => setFullscreen((f) => !f)}
        onReturnToPreview={() => {
          debugLog('ui', 'ui_return_to_preview', { pageId, field: sourceField })
          onExitSource?.()
        }}
        onSaveNow={() => void save()}
      />

      <Box className={classes.editorPaneSingle}>
        <CodeEditor
          value={content[sourceField]}
          onChange={(value) => updateField(sourceField, value)}
          language={sourceField}
          label={fieldLabel}
          wordWrap={wordWrap}
          fontSize={fontSize}
          onStatsChange={setStats}
          onViewAccessor={(getView) => {
            getViewRef.current = getView
          }}
          extraKeys={modSaveKeys}
        />
      </Box>

      {/* Compact bottom status row: language, caret, selection, save state. */}
      <Group gap="md" wrap="nowrap" className={classes.statusRow} data-testid="ide-status-row">
        <Text size="xs" c="dimmed">
          {fieldLabel}
        </Text>
        <Text size="xs" c="dimmed" data-testid="ide-caret-position">
          Ln {stats.line}, Col {stats.column}
        </Text>
        {stats.selectedChars > 0 ? (
          <Text size="xs" c="dimmed" data-testid="ide-selection-count">
            {stats.selectedChars} selected
          </Text>
        ) : null}
        {formatError !== null ? (
          <Text size="xs" c="red" role="alert" data-testid="ide-format-error">
            {UI_TEXT.ideFormatErrorLabel}
          </Text>
        ) : null}
        {/* On failure the header already announces "Save failed"; here we
            surface only the underlying detail plus the retry control so the
            failure text appears exactly once in the DOM. */}
        {status === 'error' && error ? (
          <Text size="xs" c="red">
            {error}
          </Text>
        ) : status !== 'error' ? (
          <Text size="xs" c="dimmed" ml="auto">
            {saveStateLabel}
          </Text>
        ) : null}
        {/* Content-save retry lives here (parity with the Rich editor); the
            header's Retry action belongs to page-list mutations. */}
        {status === 'error' ? (
          <Button
            size="compact-xs"
            variant="light"
            ml="auto"
            data-testid="html-editor-retry"
            onClick={retry}
          >
            {UI_TEXT.saveStatusRetry}
          </Button>
        ) : null}
      </Group>
    </div>
  )
}
