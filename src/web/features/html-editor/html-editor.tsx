import { Box, Button, Group, Stack, Switch, Tabs, Text } from '@mantine/core'
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
import { PreviewFrame } from '../html/preview-frame.js'
import { useAutosave } from '../rich-editor/use-autosave.js'
import { CodeEditor } from './code-editor.js'
import classes from './html-editor.module.css'

export interface HtmlEditorWorkspaceProps {
  pageId: string
  storedContent: string
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
 * Editable HTML-page workspace: CodeMirror tabs (HTML/CSS/JS), the per-page
 * JavaScript switch, and the Phase 4A sandboxed live preview in a responsive
 * split view. All persistence flows through the shared autosave controller;
 * all preview rendering flows through the unchanged secure builder.
 */
export default function HtmlEditorWorkspace({
  pageId,
  storedContent,
  onSaveContent,
  onFlushRef,
  onSaveStateChange
}: HtmlEditorWorkspaceProps): JSX.Element {
  const parseResult = useMemo(() => parseHtmlContent(storedContent), [storedContent])

  const [activeField, setActiveField] = useState<ContentField>('html')
  const [content, setContent] = useState<HtmlPageContentV2>(() =>
    parseResult.ok ? normalizeHtmlContent(parseResult.content) : createEmptyHtmlContent()
  )
  const [previewContent, setPreviewContent] = useState<HtmlPageContentV2>(content)

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
    }
  }, [pageId, parseResult])

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
      setPreviewContent(content)
    }, PREVIEW_REBUILD_DEBOUNCE_MS)
    return () => {
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current)
        previewTimerRef.current = null
      }
    }
  }, [content])

  const updateField = useCallback((field: ContentField, value: string): void => {
    setContent((prev) => ({ ...prev, [field]: value }))
  }, [])

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

  return (
    <div className={classes.root} data-testid="html-editor">
      <Group justify="space-between" wrap="nowrap" gap="sm" className={classes.controls}>
        <Tabs value={activeField} onChange={(value) => setActiveField(value as ContentField)}>
          <Tabs.List aria-label={UI_TEXT.editorTabsLabel}>
            <Tabs.Tab value="html">{UI_TEXT.editorTabHtml}</Tabs.Tab>
            <Tabs.Tab value="css">{UI_TEXT.editorTabCss}</Tabs.Tab>
            <Tabs.Tab value="javascript">{UI_TEXT.editorTabJs}</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <Switch
          checked={content.jsEnabled}
          onChange={toggleJs}
          label={UI_TEXT.jsEnabledToggleLabel}
          aria-label={UI_TEXT.jsEnabledToggleLabel}
          data-testid="js-enabled-toggle"
        />
      </Group>

      <div className={classes.split}>
        <Box className={classes.editorPane}>
          <CodeEditor
            key={activeField}
            value={content[activeField]}
            onChange={(value) => updateField(activeField, value)}
            language={activeField}
            label={UI_TEXT[FIELD_LABELS[activeField]]}
            extraKeys={modSaveKeys}
          />
        </Box>

        <Box className={classes.previewPane} data-testid="live-preview">
          <PreviewFrame content={previewContent} />
        </Box>
      </div>

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
