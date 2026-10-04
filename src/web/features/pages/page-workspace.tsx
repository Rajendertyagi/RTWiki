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
import type { EditorCapabilities } from '../workspace/capabilities.js'
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

/**
 * The shared toolbar shell, lazily loaded for the same reason `RichToolbar` is.
 *
 * It was imported statically at first and that was a measurable regression: the
 * model names 36 Tabler icons, so a static import pulled the whole icon set plus
 * Mantine's `ActionIcon`, `Tooltip` and `Popover` into the **eager** entry chunk,
 * where the running app's own toolbar has never been. Verified in the built
 * output before the change — `data-toolbar-item` was present in `index-*.js`.
 * After the change the shell and its icons are in a lazy chunk, matching the
 * toolbar that was already there.
 */
const DocumentToolbar = lazy(() =>
  import('../workspace/document-toolbar.js').then((m) => ({ default: m.DocumentToolbar }))
)

// Dedicated Diagram / Mind Map workspaces share one lazily loaded component
// (Mermaid itself is further code-split inside the render pipeline).
const MermaidPageWorkspace = lazy(() => import('../visual-pages/mermaid-workspace.js'))

// Markdown pages: source editor + rendered preview, lazily loaded.
const MarkdownPageWorkspace = lazy(() => import('../markdown/markdown-workspace.js'))

interface PageWorkspaceProps {
  page: Page
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

  /*
   * The Markdown page's editing capabilities, published by its workspace.
   *
   * Held here, in the component that owns the toolbar row, and handed down the
   * same way `richEditor` and `diagramActions` are — so the row renders whatever
   * the active surface published, with no per-surface branch deciding what the
   * bar contains. Null until the workspace mounts and null again when it
   * unmounts, so switching tabs cannot leave a bar whose commands act on a
   * detached view.
   */
  const [markdownCapabilities, setMarkdownCapabilities] = useState<EditorCapabilities | null>(null)

  /*
   * The Markdown page's Edit/Preview switch, published by its workspace.
   *
   * A node rather than capabilities: it is a view control, not a formatting
   * command, so it does not belong in the capability model. It renders in the
   * shared row's `trailing` slot — the same slot the Diagram page's creation
   * controls use, so a surface-owned action always lands in the same place on
   * the bar rather than in a row of its own.
   */
  const [markdownViewSwitch, setMarkdownViewSwitch] = useState<ReactNode | null>(null)

  /*
   * The row, for every page type.
   *
   * It used to exclude Markdown, which is the whole reason that page's toolbar
   * had nowhere to go and ended up in a row of its own below the header. There is
   * no page type left that has no editing surface, so the row is unconditional —
   * stated as a constant rather than a comparison because a comparison over a
   * four-value union that is always true is a lie the type checker is right to
   * reject, and a new page type then gets the row by default instead of silently
   * losing it.
   */
  const wantsToolbarRow = true

  return (
    <div className={classes.workspace}>
      {wantsToolbarRow && (
        <div
          className={classes.toolbarRow}
          data-testid={
            page.pageType === 'diagram'
              ? 'diagram-toolbar-row'
              : page.pageType === 'markdown'
                ? 'markdown-toolbar-row'
                : 'rich-toolbar-row'
          }
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
          ) : page.pageType === 'markdown' ? (
            // Rendered only once the workspace has published its capabilities, so
            // a control cannot appear before there is an editor to act on. The
            // skeleton is the same one the Rich Note uses while BlockNote loads,
            // which keeps the row from changing height as a page type changes.
            markdownCapabilities ? (
              // Suspended because the shell is lazily loaded, and the fallback is
              // the same skeleton the Rich Note uses — so switching to a Markdown
              // page does not change the row's height while the chunk arrives.
              <Suspense
                fallback={
                  <div className={classes.toolbarSkeleton} aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                }
              >
                <DocumentToolbar
                  capabilities={markdownCapabilities}
                  trailing={markdownViewSwitch}
                />
              </Suspense>
            ) : (
              <div className={classes.toolbarSkeleton} aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            )
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
          onMarkdownCapabilitiesReady={setMarkdownCapabilities}
          onMarkdownViewSwitchReady={setMarkdownViewSwitch}
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
  onDiagramCreateActionsReady,
  onMarkdownCapabilitiesReady,
  onMarkdownViewSwitchReady
}: {
  page: Page
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
  /**
   * Receives the Markdown page's editing capabilities.
   *
   * Capabilities rather than a rendered toolbar, and this is the one seam that
   * differs from `onToolbarReady` above. That one is a `ReactNode` because the
   * HTML toolbar is popover-heavy and predates the capability model. A Markdown
   * page instead publishes what CodeMirror can do, and the row renders it
   * through the shared `DocumentToolbar` — so the shell, the roving focus, the
   * overflow and the disabled treatment are owned in exactly one place, and a
   * Markdown Note cannot grow a second bar that behaves differently from a Rich
   * Note's.
   */
  onMarkdownCapabilitiesReady?: (capabilities: EditorCapabilities | null) => void
  /** Receives the Markdown page's Edit/Preview switch, for the row's trailing slot. */
  onMarkdownViewSwitchReady?: (node: ReactNode | null) => void
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
          onCapabilitiesReady={onMarkdownCapabilitiesReady}
          onViewSwitchReady={onMarkdownViewSwitchReady}
          onOpenPage={onOpenPageLink}
        />
      </Suspense>
    )
  }
  return (
    <HtmlEditorSurface
      page={page}
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
