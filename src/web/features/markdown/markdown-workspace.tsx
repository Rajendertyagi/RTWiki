import { Button, Group, Text, useComputedColorScheme } from '@mantine/core'
import { parseMarkdownPageContent } from '@rtwiki/shared/schemas/markdown-content'
import { IconDownload, IconEye, IconPencil } from '@tabler/icons-react'
// KaTeX's stylesheet, imported here so maths are styled on a **Markdown** page.
//
// `@blocknote/math-block` already imports this exact file, but only from the Rich
// Note's lazily-loaded chunk. A Markdown page never mounts the rich editor, so that
// chunk is never fetched and its CSS never arrives - measured: the full stylesheet
// (19 font references) lives in the lazy `rich-editor-*.css`, while the eagerly
// loaded `index-*.css` carried 9. Maths would have rendered with the correct DOM and
// no glyphs, which throws no error and looks merely wrong.
//
// This is the same file, not a second copy, so the CSS has one source. Verified after
// building rather than assumed; see the note in `markdown-workspace.module.css`.
import 'katex/dist/katex.min.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { updatePage } from '../../services/pages-api.js'
import { downloadTextFile, sanitizeFileName } from '../../util/file-download.js'
import { CodeEditor } from '../html-editor/code-editor.js'
import type { EditorStatus } from '../html-editor/use-codemirror.js'
import { renderMermaidSvg } from '../rich-editor/blocks/mermaid-render.js'
import { useAutosave } from '../rich-editor/use-autosave.js'
import { useEditorPreferences } from '../workspace/editor-preferences.js'
import { RightSidebarRegion } from '../workspace/right-sidebar-region.js'
import type { StatusSaveState } from '../workspace/save-state.js'
import { isAutosaveDirty, mapAutosaveStatus } from '../workspace/save-state.js'
import { attachColumnDividers } from './markdown-columns-divider.js'
import { attachMermaidDiagrams } from './markdown-mermaid-hydrate.js'
import { extractMarkdownOutline, MARKDOWN_HEADING_SELECTOR } from './markdown-outline.js'
import { renderMarkdown } from './markdown-render.js'
import classes from './markdown-workspace.module.css'
/**
 * The `:::columns` stylesheet, imported for its side effect.
 *
 * A **plain** `.css` on purpose, and the import shape matters as much as the
 * file type. Measured with this repo's Vite: a bare `import './x.module.css'`
 * emits no CSS at all, while a bare import of a plain `.css` does — and a bare
 * `.module.css` import sitting alongside a class-map import of another module
 * contributes nothing, silently, with no build error. That is how this feature
 * shipped with correct markup, 1030 passing unit tests, and no stylesheet at all.
 *
 * The class names are global rather than hashed because the markup is produced
 * as a string by `renderMarkdown`; see the header of the stylesheet. Do not add
 * `:global(...)` to it: a plain stylesheet passes that syntax through to the
 * browser, where it matches nothing.
 */
import './markdown-columns.css'

/**
 * The ` ```mermaid ` diagram stylesheet, imported for its side effect, and
 * **after** the `:::columns` one deliberately.
 *
 * `tests/markdown-columns-styles.test.ts` discovers the column stylesheet by
 * reading the *first* bare `.css` import in this file, so putting this one ahead
 * of it would silently repoint that test at the wrong file. Both are plain
 * `.css` side-effect imports for the same measured reason; see the header of
 * `markdown-mermaid.css`.
 */
import './markdown-mermaid.css'

export interface MarkdownPageWorkspaceProps {
  pageId: string
  pageTitle: string
  storedContent: string
  createdDate?: string
  updatedDate?: string
  onSaveContent?: (id: string, content: string) => Promise<boolean>
  onFlushRef?: (fn: (() => Promise<boolean>) | null) => void
  onSaveStateChange?: (state: {
    isDirty: boolean
    saveState: StatusSaveState
    error?: string | null
  }) => void
  onEditorStatusChange?: (status: EditorStatus) => void
  /** Opens a page through the controller/tab flow, for the sidebar's backlinks. */
  onOpenPage?: (pageId: string) => void
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
  pageTitle,
  storedContent,
  createdDate,
  updatedDate,
  onSaveContent,
  onFlushRef,
  onSaveStateChange,
  onEditorStatusChange,
  onOpenPage
}: MarkdownPageWorkspaceProps): JSX.Element {
  const parsed = parseMarkdownPageContent(storedContent)
  const committedSource = parsed.ok ? parsed.value.markdown : ''
  const parseFailed = !parsed.ok

  const [mode, setMode] = useState<'edit' | 'preview'>('preview')
  const [draft, setDraft] = useState(committedSource)
  const [stats, setStats] = useState<EditorStatus>({
    line: 1,
    column: 1,
    selectedChars: 0,
    formatError: null
  })

  // The reader's colour scheme, read the same way the editor's Diagram block
  // reads it. Mermaid bakes the theme into the SVG it emits, so this is a
  // **render input** and not something CSS can answer: the same diagram, drawn
  // twice, has two different documents.
  const colorScheme = useComputedColorScheme('light')

  const handleSave = async (pid: string, content: string): Promise<void> => {
    if (onSaveContent) {
      const ok = await onSaveContent(pid, content)
      if (!ok) throw new Error('Failed to save')
      return
    }
    await updatePage(pid, { content })
  }

  const { status, error, notifyEdit, flush } = useAutosave({
    pageId,
    onSave: handleSave
  })

  useEffect(() => {
    onSaveStateChange?.({
      isDirty: isAutosaveDirty(status),
      // Shared mapping. This workspace had its own `mapStatus`, which folded
      // `'dirty'` into `'clean'` - so a Markdown page reported "Saved" while the
      // edit was still pending, exactly as a Rich Note did.
      saveState: mapAutosaveStatus(status),
      error: status === 'error' ? error : null
    })
  }, [status, error, onSaveStateChange])

  useEffect(() => {
    onFlushRef?.(flush)
    return () => {
      onFlushRef?.(null)
    }
  }, [flush, onFlushRef])

  // Lift caret/selection to the global status bar.
  useEffect(() => {
    onEditorStatusChange?.({ ...stats, formatError: null })
  }, [stats, onEditorStatusChange])

  const updateMarkdown = (value: string): void => {
    setDraft(value)
    notifyEdit(JSON.stringify({ version: 1, markdown: value }))
  }

  const html = useMemo(() => renderMarkdown(draft), [draft])

  // The outline follows the draft, not the saved document, so it updates as the
  // reader types. It is built by the same lexer that renders the preview, so the
  // entry order and the heading order cannot drift apart.
  const outline = useMemo(() => extractMarkdownOutline(draft), [draft])

  // Preview element, so an outline click can scroll to the heading it names.
  const previewRef = useRef<HTMLDivElement | null>(null)
  // Set on click and consumed by the effect below. Navigation has to survive the
  // switch from Edit to Preview, where the target element does not exist yet.
  const [pendingHeading, setPendingHeading] = useState<string | null>(null)

  const navigateToHeading = useCallback((blockId: string): void => {
    setMode('preview')
    setPendingHeading(blockId)
  }, [])

  /*
   * Makes a rendered `:::columns` divider draggable.
   *
   * Deliberately **not** a React child of the preview: the preview is a
   * `dangerouslySetInnerHTML` element whose contents are replaced from scratch,
   * so anything React-owned inside it would remount constantly. The preview
   * element itself is a stable container that `innerHTML` does not replace, so
   * the wiring lives on the container and is delegated.
   *
   * Keyed on `mode` alone, and that is deliberate rather than an oversight. This
   * effect owns exactly one thing: the *identity of the preview element*, which
   * `mode` changes and nothing else does. The wiring's other dependency — the
   * divider elements inside it — is owned by `attachColumnDividers` itself,
   * which watches the container for changes to its children.
   *
   * That split exists because the two signals are not interchangeable. Measured
   * in a browser: the framework replaced the preview's `innerHTML` **17 ms after**
   * this effect ran, with the row already present, and **no React dependency
   * changed** — `html` was byte-identical. An effect keyed on `html` therefore
   * does not re-run, the wiring keeps references to detached dividers, and every
   * `pointerdown` and `keydown` lookup misses: the listener still fires, still
   * gets the right event on the right target, still does not throw, and silently
   * does nothing. Drag and keyboard were dead on every page opened from the
   * sidebar, and worked only after an Edit → Preview round trip, which *does*
   * change `mode`. A `MutationObserver` on the container is the signal that
   * actually arrives.
   */
  useEffect(() => {
    if (mode !== 'preview') return
    const preview = previewRef.current
    if (!preview) return
    return attachColumnDividers(preview)
  }, [mode])

  /*
   * Renders every ` ```mermaid ` fence in the preview.
   *
   * **The same shape as the divider wiring above, and for the same reasons**:
   * the preview's `innerHTML` is replaced from scratch whenever the rendered
   * Markdown changes, so nothing React owns may live inside it, and the signal
   * that the contents changed is a `MutationObserver` on the container rather
   * than a React dependency. `attachMermaidDiagrams` owns that observer.
   *
   * Measured for this effect, with the hydration module instrumented: the
   * framework writes the preview's children at 1105 ms, the first scan runs at
   * 1115 ms and does find the placeholder, and the framework writes the children
   * **again** at 1164 ms with new nodes. A render started by the first scan
   * therefore lands in a node nobody can see. With the observer removed, every
   * test in `tests/browser/markdown-mermaid.pwspec.ts` fails - not only the
   * re-rendering one.
   *
   * Keyed on `mode` **and** `colorScheme`, and both are load-bearing:
   *
   * - `mode` is the identity of the preview element, which only this changes.
   * - `colorScheme` is the render input. Mermaid's theme is baked into the SVG it
   *   emits, so a scheme change cannot be handled in CSS and has to be a
   *   re-render. The teardown aborts the renders in flight and the fresh attach
   *   re-renders every fence, which is also why `attachMermaidDiagrams` resets a
   *   placeholder to its pre-render state before starting.
   *
   * `renderMermaidSvg` is the editor's single renderer, passed in rather than
   * wrapped, so this feature cannot grow a second Mermaid configuration.
   */
  useEffect(() => {
    if (mode !== 'preview') return
    const preview = previewRef.current
    if (!preview) return
    return attachMermaidDiagrams(preview, {
      pageId,
      theme: colorScheme === 'dark' ? 'dark' : 'default',
      render: renderMermaidSvg
    })
  }, [mode, colorScheme, pageId])

  useEffect(() => {
    if (pendingHeading === null) return
    // `blockId` is the heading's position in the lexer's output, which is the same
    // order the preview emits heading elements in.
    const index = Number(pendingHeading)
    const headings = previewRef.current?.querySelectorAll(MARKDOWN_HEADING_SELECTOR)
    const target = Number.isInteger(index) ? headings?.[index] : undefined
    target?.scrollIntoView({ block: 'start' })
    setPendingHeading(null)
    // Only `pendingHeading` is read here. Switching to Preview happens in the same
    // event as the click, so React batches both into one commit and the preview
    // element is already mounted by the time this effect runs. A stale index (the
    // outline is derived from the draft, which can change under the reader) simply
    // finds no element and does nothing.
  }, [pendingHeading])

  const editorPrefs = useEditorPreferences()

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
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<IconDownload size={12} />}
          onClick={() =>
            downloadTextFile(`${sanitizeFileName(pageTitle)}.md`, draft, 'text/markdown')
          }
          data-testid="markdown-export-button"
        >
          {UI_TEXT.markdownExportLabel}
        </Button>
      </Group>

      <div className={classes.contentRow}>
        {mode === 'edit' ? (
          <div className={classes.editorPane}>
            <CodeEditor
              value={draft}
              onChange={updateMarkdown}
              language="markdown"
              label={UI_TEXT.markdownEditorLabel}
              wordWrap={editorPrefs.wordWrap}
              onStatsChange={(s) => setStats((prev) => ({ ...prev, ...s }))}
            />
          </div>
        ) : (
          <div
            ref={previewRef}
            className={classes.previewPane}
            data-testid="markdown-rendered"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized Markdown HTML via DOMPurify (micromark escapes raw HTML; strict allowlist on top)
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}

        <RightSidebarRegion
          pageId={pageId}
          outline={outline}
          pageTypeLabel={UI_TEXT.markdownPage}
          createdDate={createdDate ?? ''}
          updatedDate={updatedDate ?? ''}
          onNavigateToHeading={navigateToHeading}
          onOpenPage={onOpenPage}
        />
      </div>
    </div>
  )
}
