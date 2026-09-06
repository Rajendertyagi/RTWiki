import { Button, Group, Text } from '@mantine/core'
import { parseMarkdownPageContent } from '@rtwiki/shared/schemas/markdown-content'
import { IconEye, IconPencil } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { pageTypeLabel } from '../../components/page-type-badge.js'
import { UI_TEXT } from '../../config/index.js'
import { updatePage } from '../../services/pages-api.js'
import { CodeEditor } from '../html-editor/code-editor.js'
import type { EditorStats } from '../html-editor/use-codemirror.js'
import { useAutosave } from '../rich-editor/use-autosave.js'
import { StatusBar, type StatusSaveState } from '../workspace/status-bar.js'
import { renderMarkdown } from './markdown-render.js'
import classes from './markdown-workspace.module.css'

export interface MarkdownPageWorkspaceProps {
  pageId: string
  storedContent: string
  onSaveContent?: (id: string, content: string) => Promise<boolean>
  onFlushRef?: (fn: (() => Promise<boolean>) | null) => void
  onSaveStateChange?: (state: {
    isDirty: boolean
    saveState: 'clean' | 'saving' | 'saved' | 'error'
  }) => void
}

/**
 * Dedicated full-page workspace for the Markdown page type.
 *
 * Opens in rendered Preview by default; the Edit/Preview switch reveals a
 * CodeMirror source editor whose draft is the real Markdown text (never a
 * second Rich Note). Autosave flows through the shared autosave controller, so
 * save state, flush-on-navigation and late-response guards behave exactly like
 * every other editor.
 */
export default function MarkdownPageWorkspace({
  pageId,
  storedContent,
  onSaveContent,
  onFlushRef,
  onSaveStateChange
}: MarkdownPageWorkspaceProps): JSX.Element {
  const parsed = parseMarkdownPageContent(storedContent)
  const committedSource = parsed.ok ? parsed.value.markdown : ''
  const parseFailed = !parsed.ok

  const [mode, setMode] = useState<'edit' | 'preview'>('preview')
  const [draft, setDraft] = useState(committedSource)
  const [stats, setStats] = useState<EditorStats>({ line: 1, column: 1, selectedChars: 0 })

  const handleSave = async (pid: string, content: string): Promise<void> => {
    if (onSaveContent) {
      const ok = await onSaveContent(pid, content)
      if (!ok) throw new Error('Failed to save')
      return
    }
    await updatePage(pid, { content })
  }

  const { status, error, notifyEdit, retry, flush } = useAutosave({
    pageId,
    onSave: handleSave
  })

  useEffect(() => {
    onSaveStateChange?.({
      isDirty: status !== 'idle' && status !== 'saved',
      saveState: mapStatus(status)
    })
  }, [status, onSaveStateChange])

  useEffect(() => {
    onFlushRef?.(flush)
    return () => {
      onFlushRef?.(null)
    }
  }, [flush, onFlushRef])

  const updateMarkdown = (value: string): void => {
    setDraft(value)
    notifyEdit(JSON.stringify({ version: 1, markdown: value }))
  }

  const html = useMemo(() => renderMarkdown(draft), [draft])

  const statusBarSaveState: StatusSaveState =
    status === 'error' ? 'error' : status === 'saving' ? 'saving' : 'saved'
  const wordCount = useMemo(() => draft.trim().match(/\S+/g)?.length ?? 0, [draft])

  if (parseFailed) {
    return (
      <div className={classes.root} data-testid="markdown-workspace">
        <Group justify="center" className={classes.parseError} role="alert">
          <Text size="sm" c="red">
            {UI_TEXT.richEditorLoadError}
          </Text>
        </Group>
      </div>
    )
  }

  return (
    <div className={classes.root} data-testid="markdown-workspace">
      <Group justify="space-between" wrap="nowrap" gap="sm" className={classes.bar}>
        <Group gap="xs" wrap="nowrap">
          <Button
            size="compact-xs"
            variant={mode === 'edit' ? 'filled' : 'light'}
            leftSection={<IconPencil size={12} />}
            onClick={() => setMode('edit')}
            data-testid="markdown-edit-button"
          >
            {UI_TEXT.markdownWorkspaceEditLabel}
          </Button>
          <Button
            size="compact-xs"
            variant={mode === 'preview' ? 'filled' : 'light'}
            leftSection={<IconEye size={12} />}
            onClick={() => setMode('preview')}
            data-testid="markdown-preview-button"
          >
            {UI_TEXT.markdownWorkspacePreviewLabel}
          </Button>
        </Group>
      </Group>

      {mode === 'edit' ? (
        <div className={classes.editorPane}>
          <CodeEditor
            value={draft}
            onChange={updateMarkdown}
            language="markdown"
            label={UI_TEXT.markdownEditorLabel}
            wordWrap
            onStatsChange={setStats}
          />
        </div>
      ) : (
        <div
          className={classes.previewPane}
          data-testid="markdown-rendered"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized Markdown HTML via DOMPurify (marked + strict allowlist)
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}

      <StatusBar
        pageTypeLabel={pageTypeLabel('markdown')}
        saveState={statusBarSaveState}
        saveError={status === 'error' ? error : null}
        onRetry={retry}
      >
        {wordCount > 0 ? (
          <Text size="xs" c="dimmed" data-testid="status-word-count">
            {wordCount} words
          </Text>
        ) : null}
        <Text size="xs" c="dimmed" data-testid="ide-caret-position">
          Ln {stats.line}, Col {stats.column}
        </Text>
        {stats.selectedChars > 0 ? (
          <Text size="xs" c="dimmed" data-testid="ide-selection-count">
            {stats.selectedChars} selected
          </Text>
        ) : null}
      </StatusBar>
    </div>
  )
}

function mapStatus(status: string): 'clean' | 'saving' | 'saved' | 'error' {
  if (status === 'saving') return 'saving'
  if (status === 'error') return 'error'
  if (status === 'saved') return 'saved'
  return 'clean'
}
