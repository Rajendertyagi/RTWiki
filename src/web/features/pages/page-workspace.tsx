import { Box, Button, Group, Skeleton, Stack } from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { parseHtmlContent } from '@rtwiki/shared/schemas/html-content'
import { IconPlus } from '@tabler/icons-react'
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { HtmlPlaceholder } from '../html/html-placeholder.js'
import { HtmlEditorErrorBoundary } from '../html-editor/html-editor-error-boundary.js'
import type { EditorStatus } from '../html-editor/use-codemirror.js'
import { DiagramTemplateBar } from '../rich-editor/blocks/diagram-template-bar.js'
import type { AnyRichEditor } from '../rich-editor/schema.js'
import type { DiagramCreateActions } from '../visual-pages/mermaid-workspace.js'
import type { StatusSaveState } from '../workspace/status-bar.js'
import { EditorHeader } from './editor-header.js'
import classes from './page-workspace.module.css'

// CodeMirror is heavy and only needed on HTML pages — loaded as its own chunk.
const HtmlEditorWorkspace = lazy(() => import('../html-editor/html-editor.js'))

// BlockNote (+KaTeX for math blocks) is heavy and only needed on Rich Notes;
// loaded as its own chunk so the initial application bundle stays lean.
const RichEditor = lazy(() =>
  import('../rich-editor/rich-editor.js').then((m) => ({ default: m.RichEditor }))
)

// The toolbar is part of the rich-editor feature and is reached through the same
// lazy module as the editor above, so it lands in one chunk rather than pulling
// BlockNote and ProseMirror into the initial bundle. It only ever renders once
// `richEditor` exists, which means that chunk has already resolved by then, so this
// adds no request of its own.
const RichToolbar = lazy(() =>
  import('../rich-editor/rich-editor.js').then((m) => ({ default: m.RichToolbar }))
)

// Dedicated Diagram / Mind Map workspaces share one lazily loaded component
// (Mermaid itself is further code-split inside the render pipeline).
const MermaidPageWorkspace = lazy(() => import('../visual-pages/mermaid-workspace.js'))

// Markdown pages: source editor + rendered preview, lazily loaded.
const MarkdownPageWorkspace = lazy(() => import('../markdown/markdown-workspace.js'))

interface PageWorkspaceProps {
  page: Page
  /** Display-only parent chain for the open page (no navigation). */
  breadcrumb?: string[]
  /** Persists editor content and syncs the pages list. */
  onSaveContent?: (id: string, content: string) => Promise<boolean>
  onBack: () => void
  /**
   * Renames THIS page by id — the same (id, title) contract as the tree, so
   * header and tree renames share one controller path.
   */
  onRenamePage: (id: string, title: string) => Promise<boolean>
  onDuplicate: () => void
  onDelete: () => void
  onFlushRef: (fn: (() => Promise<boolean>) | null) => void
  onSaveStateChange: (state: {
    isDirty: boolean
    saveState: StatusSaveState
    error?: string | null
  }) => void
  /** Active HTML source subfile for this page; null = rendered preview. */
  htmlSourceField?: 'html' | 'css' | 'javascript' | null
  /** Switches the active HTML source subfile (or back to preview). */
  onSourceFieldChange?: (field: 'preview' | 'html' | 'css' | 'javascript') => void
  /** Lifts caret/selection + format error to the global status bar. */
  onEditorStatusChange?: (status: EditorStatus) => void
  /** All living pages (id+title) for internal-link insertion. */
  linkablePages?: Array<{ id: string; title: string }>
  /** Opens a page through the controller/tab flow. */
  onOpenPageLink?: (pageId: string) => void
  /** Returns from a source subfile to the rendered preview. */
  onExitHtmlSource?: () => void
}

export function PageWorkspace({
  page,
  breadcrumb = [],
  onSaveContent,
  onBack,
  onRenamePage,
  onDuplicate,
  onDelete,
  onFlushRef,
  onSaveStateChange,
  htmlSourceField = null,
  onSourceFieldChange,
  onEditorStatusChange,
  onExitHtmlSource,
  linkablePages = [],
  onOpenPageLink
}: PageWorkspaceProps): JSX.Element {
  // Rich pages host the persistent toolbar OUTSIDE the editor component so
  // it sits directly under the tab strip, above the title/actions row. The
  // slot is unconditional with a fixed height: while the editor instance
  // initializes a same-height placeholder holds the space, so the title and
  // document never shift when the real controls arrive. HTML pages expose
  // their toolbar through onToolbarReady into the same row (see below).
  const [richEditor, setRichEditor] = useState<AnyRichEditor | null>(null)
  const [htmlToolbar, setHtmlToolbar] = useState<ReactNode | null>(null)
  // The Diagram page's creation controls. Handed up by the workspace rather than
  // rendered inside it, so the row is the same one the Rich Note and HTML page
  // use and the three toolbars sit at the same height on every page type. Null
  // until the workspace mounts, and null again if it unmounts.
  //
  // Held as an object of actions rather than as bare functions on purpose. A
  // `setState` given a function calls it as an updater with the previous state, so
  // storing a handler directly would invoke it with `null` the moment it arrived —
  // which is a diagram with a null source, a rejected save, and a toolbar that
  // never appears. An object cannot be mistaken for an updater, so both actions
  // travel together in something the setter treats as a plain value.
  const [diagramActions, setDiagramActions] = useState<DiagramCreateActions | null>(null)

  const wantsToolbarRow =
    page.pageType === 'rich' || page.pageType === 'html' || page.pageType === 'diagram'

  return (
    <div className={classes.workspace}>
      {wantsToolbarRow && (
        <div
          className={classes.toolbarRow}
          data-testid={page.pageType === 'diagram' ? 'diagram-toolbar-row' : 'rich-toolbar-row'}
          aria-busy={page.pageType === 'rich' && !richEditor}
        >
          {page.pageType === 'rich' ? (
            richEditor ? (
              <Suspense
                fallback={
                  <div className={classes.toolbarSkeleton} aria-hidden="true">
                    <span />
                  </div>
                }
              >
                <RichToolbar editor={richEditor} linkablePages={linkablePages} />
              </Suspense>
            ) : (
              <div className={classes.toolbarSkeleton} aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            )
          ) : page.pageType === 'html' ? (
            htmlToolbar
          ) : // Visible by default and never gated on edit mode: choosing a
          // template adds that diagram to the page. "Add diagram" sits beside the
          // chooser rather than in the workspace below, because both are the same
          // kind of action — creating a diagram on this page — and splitting them
          // across two bars meant the one that added a *specific* type was above
          // the page header while the one that added a default was below it.
          //
          // Rendered only once the workspace has handed its actions up, so a click
          // cannot land before there is anything to add to.
          diagramActions ? (
            <Group gap="xs" wrap="nowrap" className={classes.diagramCreateRow}>
              <Button
                size="compact-sm"
                variant="light"
                className={classes.addDiagramButton}
                leftSection={<IconPlus size={14} />}
                onClick={diagramActions.addDiagram}
                // Disabled rather than failing on click: the cap is a real limit
                // and the control should say so instead of doing nothing.
                disabled={!diagramActions.canAdd}
                data-testid="diagram-add-block"
              >
                {UI_TEXT.diagramAddBlockLabel}
              </Button>
              <DiagramTemplateBar onPick={diagramActions.pickTemplate} />
            </Group>
          ) : (
            <div className={classes.toolbarSkeleton} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      )}

      <EditorHeader
        page={page}
        onBack={onBack}
        onRename={(title) => onRenamePage(page.id, title)}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />

      <div className={classes.content}>
        {/* Keyed by page: a page switch remounts the editors fresh. */}
        <PageEditors
          key={page.id}
          page={page}
          breadcrumb={breadcrumb}
          linkablePages={linkablePages}
          onOpenPageLink={onOpenPageLink}
          sourceField={htmlSourceField}
          onExitSource={onExitHtmlSource}
          onSourceFieldChange={onSourceFieldChange}
          onEditorStatusChange={onEditorStatusChange}
          onSaveContent={onSaveContent}
          onBack={onBack}
          onFlushRef={onFlushRef}
          onSaveStateChange={onSaveStateChange}
          onRichEditorReady={setRichEditor}
          onToolbarReady={setHtmlToolbar}
          onDiagramCreateActionsReady={setDiagramActions}
        />
      </div>
    </div>
  )
}

/**
 * Editor surface for the open page, mounted one frame after the workspace
 * appears. Mounting BlockNote in the same commit that closes a dialog (e.g.
 * the create-note modal) starves the modal's exit transition on loaded
 * machines and leaves a pointer-blocking overlay behind; the deferred mount
 * lets the exit finish first.
 */
function PageEditors({
  page,
  breadcrumb,
  linkablePages,
  onOpenPageLink,
  sourceField,
  onExitSource,
  onSourceFieldChange,
  onEditorStatusChange,
  onSaveContent,
  onBack,
  onFlushRef,
  onSaveStateChange,
  onRichEditorReady,
  onToolbarReady,
  onDiagramCreateActionsReady
}: {
  page: Page
  breadcrumb?: string[]
  linkablePages?: Array<{ id: string; title: string }>
  onOpenPageLink?: (pageId: string) => void
  sourceField: 'html' | 'css' | 'javascript' | null
  onExitSource?: () => void
  onSourceFieldChange?: (field: 'preview' | 'html' | 'css' | 'javascript') => void
  onEditorStatusChange?: (status: EditorStatus) => void
  onSaveContent?: (id: string, content: string) => Promise<boolean>
  onBack: () => void
  onFlushRef: (fn: (() => Promise<boolean>) | null) => void
  onSaveStateChange: (state: { isDirty: boolean; saveState: StatusSaveState }) => void
  onRichEditorReady: (editor: AnyRichEditor | null) => void
  onToolbarReady?: (node: ReactNode | null) => void
  onDiagramCreateActionsReady?: (actions: DiagramCreateActions | null) => void
}): JSX.Element | null {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  if (!mounted) return null
  if (page.pageType === 'rich') {
    return (
      <Suspense fallback={<RichEditorSkeleton />}>
        <RichEditor
          pageId={page.id}
          storedContent={page.content}
          pageTitle={page.title}
          createdDate={page.createdAt}
          updatedDate={page.updatedAt}
          onSaveContent={onSaveContent}
          onBack={onBack}
          onFlushRef={onFlushRef}
          onSaveStateChange={onSaveStateChange}
          onEditorReady={onRichEditorReady}
          toolbarExternal
          linkablePages={linkablePages}
          onOpenPage={onOpenPageLink}
        />
      </Suspense>
    )
  }
  if (page.pageType === 'diagram') {
    return (
      <Suspense fallback={<VisualWorkspaceSkeleton />}>
        <MermaidPageWorkspace
          key={page.id}
          pageId={page.id}
          storedContent={page.content}
          pageType={page.pageType}
          createdDate={page.createdAt}
          updatedDate={page.updatedAt}
          onSaveContent={onSaveContent}
          onFlushRef={onFlushRef}
          onSaveStateChange={onSaveStateChange}
          onOpenPage={onOpenPageLink}
          onCreateActionsReady={onDiagramCreateActionsReady}
        />
      </Suspense>
    )
  }
  if (page.pageType === 'markdown') {
    return (
      <Suspense fallback={<VisualWorkspaceSkeleton />}>
        <MarkdownPageWorkspace
          key={page.id}
          pageId={page.id}
          pageTitle={page.title}
          storedContent={page.content}
          createdDate={page.createdAt}
          updatedDate={page.updatedAt}
          onSaveContent={onSaveContent}
          onFlushRef={onFlushRef}
          onSaveStateChange={onSaveStateChange}
          onEditorStatusChange={onEditorStatusChange}
          onOpenPage={onOpenPageLink}
        />
      </Suspense>
    )
  }
  return (
    <HtmlEditorSurface
      page={page}
      breadcrumb={breadcrumb ?? []}
      sourceField={sourceField}
      onExitSource={onExitSource}
      onSourceFieldChange={onSourceFieldChange}
      onEditorStatusChange={onEditorStatusChange}
      onSaveContent={onSaveContent}
      onBack={onBack}
      onFlushRef={onFlushRef}
      onSaveStateChange={onSaveStateChange}
      onToolbarReady={onToolbarReady}
    />
  )
}

/**
 * HTML-page surface. Malformed stored content keeps the placeholder — it is
 * never overwritten and never silently "fixed". Valid content (v1 or v2)
 * opens the lazily loaded editable workspace with its live preview.
 */
function HtmlEditorSurface({
  page,
  breadcrumb,
  sourceField,
  onExitSource,
  onSourceFieldChange,
  onEditorStatusChange,
  onSaveContent,
  onBack,
  onFlushRef,
  onSaveStateChange,
  onToolbarReady
}: {
  page: Page
  breadcrumb: string[]
  sourceField: 'html' | 'css' | 'javascript' | null
  onExitSource?: () => void
  onSourceFieldChange?: (field: 'preview' | 'html' | 'css' | 'javascript') => void
  onEditorStatusChange?: (status: EditorStatus) => void
  onSaveContent?: (id: string, content: string) => Promise<boolean>
  onBack: () => void
  onFlushRef: (fn: (() => Promise<boolean>) | null) => void
  onSaveStateChange: (state: { isDirty: boolean; saveState: StatusSaveState }) => void
  onToolbarReady?: (node: ReactNode | null) => void
}): JSX.Element {
  const parsed = parseHtmlContent(page.content)
  if (!parsed.ok) {
    return <HtmlPlaceholder />
  }
  return (
    <HtmlEditorErrorBoundary onBack={onBack}>
      <Suspense fallback={<HtmlEditorSkeleton />}>
        <HtmlEditorWorkspace
          key={page.id}
          pageId={page.id}
          storedContent={page.content}
          sourceField={sourceField}
          onExitSource={onExitSource}
          onSourceFieldChange={onSourceFieldChange}
          onEditorStatusChange={onEditorStatusChange}
          onSaveContent={onSaveContent}
          breadcrumbLabels={[...breadcrumb, page.title]}
          onBack={onBack}
          onFlushRef={onFlushRef}
          onSaveStateChange={onSaveStateChange}
          onToolbarReady={onToolbarReady}
        />
      </Suspense>
    </HtmlEditorErrorBoundary>
  )
}

function HtmlEditorSkeleton(): JSX.Element {
  return (
    <Stack gap="sm" p="md" aria-busy="true" aria-label="Loading the HTML editor…">
      <Box w="100%" h={22}>
        <Skeleton height={22} radius="sm" />
      </Box>
      <Box w="100%" flex={1}>
        <Skeleton height="100%" radius="sm" />
      </Box>
    </Stack>
  )
}

function RichEditorSkeleton(): JSX.Element {
  return (
    <Stack gap="sm" p="md" aria-busy="true" aria-label="Loading the editor…">
      <Box w="100%" h={22}>
        <Skeleton height={22} radius="sm" />
      </Box>
      <Box w="100%" flex={1}>
        <Skeleton height="100%" radius="sm" />
      </Box>
    </Stack>
  )
}

function VisualWorkspaceSkeleton(): JSX.Element {
  return (
    <Stack gap="sm" p="md" aria-busy="true" aria-label="Loading the workspace…">
      <Box w="100%" h={22}>
        <Skeleton height={22} radius="sm" />
      </Box>
      <Box w="100%" flex={1}>
        <Skeleton height="100%" radius="sm" />
      </Box>
    </Stack>
  )
}
