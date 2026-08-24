import { Box, Button, Group, Stack, Switch, Text } from '@mantine/core'
import { PREVIEW_REBUILD_DEBOUNCE_MS } from '@rtwiki/shared/constants'
import {
  createEmptyHtmlContent,
  type HtmlPageContentV2,
  normalizeHtmlContent,
  parseHtmlContent,
  serializeHtmlContent
} from '@rtwiki/shared/schemas/html-content'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { createThrottledEmitter, debugLog, safeHash } from '../../diagnostics/debug-log.js'
import { PreviewFrame } from '../html/preview-frame.js'
import { useAutosave } from '../rich-editor/use-autosave.js'
import { CodeEditor } from './code-editor.js'
import classes from './html-editor.module.css'

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
 * - null: rendered preview only (the student view) with the JS gate switch.
 * - html/css/javascript: a single CodeMirror editor for that field with an
 *   explicit return-to-preview action.
 * All persistence flows through the shared autosave controller writing
 * canonical v2 JSON; all rendering flows through the unchanged secure builder.
 */
export default function HtmlEditorWorkspace({
  pageId,
  storedContent,
  sourceField,
  onExitSource,
  onSaveContent,
  onFlushRef,
  onSaveStateChange
}: HtmlEditorWorkspaceProps): JSX.Element {
  const parseResult = useMemo(() => parseHtmlContent(storedContent), [storedContent])

  const [content, setContent] = useState<HtmlPageContentV2>(() =>
    parseResult.ok ? normalizeHtmlContent(parseResult.content) : createEmptyHtmlContent()
  )
  const [previewContent, setPreviewContent] = useState<HtmlPageContentV2>(content)

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

  // Reset local state when switching between pages.
  useEffect(() => {
    void pageId
    if (parseResult.ok) {
      const normalized = normalizeHtmlContent(parseResult.content)
      setContent(normalized)
      setPreviewContent(normalized)
      debugLog('editor', 'editor_draft_replaced', {
        pageId,
        len: normalized.html.length + normalized.css.length + normalized.javascript.length,
        hash: safeHash(normalized.html + normalized.css + normalized.javascript)
      })
    }
  }, [pageId, parseResult])

  // Debug Mode: source-field switches (requested/completed in one commit —
  // the switch is synchronous state, so both observations carry the same tick).
  const previousFieldRef = useRef(sourceField)
  useEffect(() => {
    if (previousFieldRef.current === sourceField) return
    debugLog('editor', 'editor_source_switch_requested', {
      pageId,
      field: sourceField ?? 'preview'
    })
    previousFieldRef.current = sourceField
    debugLog('editor', 'editor_source_switch_completed', {
      pageId,
      field: sourceField ?? 'preview'
    })
  }, [sourceField, pageId])

  // Debug Mode: throttled transaction observation (latest keystroke stats at
  // most once per second; length and safe hash only, never content).
  const emitTransaction = useMemo(
    () =>
      createThrottledEmitter(1000, (field: ContentField, value: string) => {
        debugLog('editor', 'editor_transaction', {
          pageId,
          field,
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
      setContent((prev) => ({ ...prev, [field]: value }))
      emitTransaction(field, value)
    },
    [emitTransaction]
  )

  const toggleJs = useCallback((): void => {
    setContent((prev) => ({ ...prev, jsEnabled: !prev.jsEnabled }))
  }, [])

  const manualSave = useCallback((): boolean => {
    void save()
    return true
  }, [save])

  const modSaveKeys = useMemo(() => [{ key: 'Mod-s', run: manualSave }], [manualSave])

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

  // Rendered parent view ("student view"): the finished page only, no
  // source panes. An empty page shows a simple empty state instead of an
  // empty sandbox frame.
  if (sourceField === null) {
    const isEmpty =
      content.html.trim() === '' && content.css.trim() === '' && content.javascript.trim() === ''
    return (
      <div className={classes.root} data-testid="html-preview-view">
        <Group justify="flex-end" gap="sm" className={classes.controls}>
          <Switch
            checked={content.jsEnabled}
            onChange={toggleJs}
            label={UI_TEXT.jsEnabledToggleLabel}
            aria-label={UI_TEXT.jsEnabledToggleLabel}
            data-testid="js-enabled-toggle"
          />
        </Group>
        {isEmpty ? (
          <Stack align="center" justify="center" gap="xs" className={classes.previewPane}>
            <Text c="dimmed">{UI_TEXT.htmlPreviewEmpty}</Text>
          </Stack>
        ) : (
          <Box className={classes.previewPaneFull} data-testid="live-preview">
            <PreviewFrame content={previewContent} />
          </Box>
        )}
      </div>
    )
  }

  // Source subfile view: exactly one CodeMirror editor for the chosen field,
  // no permanent split-screen preview, plus an explicit return action.
  return (
    <div className={classes.root} data-testid="html-source-view">
      <Group justify="space-between" wrap="nowrap" gap="sm" className={classes.controls}>
        <Text size="sm" fw={600}>
          {UI_TEXT[FIELD_LABELS[sourceField]]}
        </Text>
        <Group gap="sm" wrap="nowrap">
          <Switch
            checked={content.jsEnabled}
            onChange={toggleJs}
            label={UI_TEXT.jsEnabledToggleLabel}
            aria-label={UI_TEXT.jsEnabledToggleLabel}
            data-testid="js-enabled-toggle"
          />
          <Button
            size="compact-xs"
            variant="light"
            onClick={() => {
              debugLog('ui', 'ui_return_to_preview', { pageId, field: sourceField })
              onExitSource?.()
            }}
            data-testid="return-to-preview"
          >
            {UI_TEXT.htmlSourceBackToPreview}
          </Button>
        </Group>
      </Group>

      <Box className={classes.editorPaneSingle}>
        <CodeEditor
          key={sourceField}
          value={content[sourceField]}
          onChange={(value) => updateField(sourceField, value)}
          language={sourceField}
          label={UI_TEXT[FIELD_LABELS[sourceField]]}
          extraKeys={modSaveKeys}
        />
      </Box>

      {status === 'error' ? (
        <Group gap="xs" p="xs">
          <Text size="sm" c="red">
            {error ?? UI_TEXT.saveFailedRetryHint}
          </Text>
          {/* Content-save retry lives here (parity with the Rich editor); the
              header's Retry action belongs to page-list mutations. */}
          <Button size="xs" variant="light" data-testid="html-editor-retry" onClick={retry}>
            {UI_TEXT.saveStatusRetry}
          </Button>
        </Group>
      ) : null}
    </div>
  )
}
