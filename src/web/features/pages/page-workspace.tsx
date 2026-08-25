import { Box, Skeleton, Stack, Text } from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { parseHtmlContent } from '@rtwiki/shared/schemas/html-content'
import { lazy, Suspense, useEffect, useState } from 'react'
import { HtmlPlaceholder } from '../html/html-placeholder.js'
import { HtmlEditorErrorBoundary } from '../html-editor/html-editor-error-boundary.js'
import { RichToolbar } from '../rich-editor/rich-toolbar.js'
import type { AnyRichEditor } from '../rich-editor/schema.js'
import { EditorHeader } from './editor-header.js'
import classes from './page-workspace.module.css'

// CodeMirror is heavy and only needed on HTML pages — loaded as its own chunk.
const HtmlEditorWorkspace = lazy(() => import('../html-editor/html-editor.js'))

// BlockNote (+KaTeX for math blocks) is heavy and only needed on Rich Notes;
// loaded as its own chunk so the initial application bundle stays lean.
const RichEditor = lazy(() =>
  import('../rich-editor/rich-editor.js').then((m) => ({ default: m.RichEditor }))
)

// Dedicated Diagram / Mind Map workspaces share one lazily loaded component
// (Mermaid itself is further code-split inside the render pipeline).
const MermaidPageWorkspace = lazy(() => import('../visual-pages/mermaid-workspace.js'))

interface PageWorkspaceProps {
  page: Page
  /** Display-only parent chain for the open page (no navigation). */
  breadcrumb?: string[]
  /** Persists editor content and syncs the pages list. */
  onSaveContent?: (id: string, content: string) => Promise<boolean>
  isDirty: boolean
  saveState: 'clean' | 'saving' | 'saved' | 'error'
  onSave: () => Promise<boolean>
  onRetry: () => Promise<boolean>
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
    saveState: 'clean' | 'saving' | 'saved' | 'error'
  }) => void
  /** Active HTML source subfile for this page; null = rendered preview. */
  htmlSourceField?: 'html' | 'css' | 'javascript' | null
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
  isDirty,
  saveState,
  onSave,
  onRetry,
  onBack,
  onRenamePage,
  onDuplicate,
  onDelete,
  onFlushRef,
  onSaveStateChange,
  htmlSourceField = null,
  onExitHtmlSource,
  linkablePages = [],
  onOpenPageLink
}: PageWorkspaceProps): JSX.Element {
  // Rich pages host the persistent toolbar OUTSIDE the editor component so
  // it sits directly under the tab strip, above the title/actions row. The
  // slot is unconditional with a fixed height: while the editor instance
  // initializes a same-height placeholder holds the space, so the title and
  // document never shift when the real controls arrive.
  const [richEditor, setRichEditor] = useState<AnyRichEditor | null>(null)

  return (
    <div className={classes.workspace}>
      {page.pageType === 'rich' ? (
        <div className={classes.toolbarRow} data-testid="rich-toolbar-row" aria-busy={!richEditor}>
          {richEditor ? (
            <RichToolbar editor={richEditor} />
          ) : (
            <div className={classes.toolbarSkeleton} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      ) : null}

      <EditorHeader
        page={page}
        isDirty={isDirty}
        saveState={saveState}
        onSave={onSave}
        onRetry={onRetry}
        onBack={onBack}
        onRename={(title) => onRenamePage(page.id, title)}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />

      {breadcrumb.length > 0 ? (
        <Text size="xs" c="dimmed" aria-label="Page location" data-testid="page-breadcrumb">
          {breadcrumb.join(' / ')}
        </Text>
      ) : null}
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
          onSaveContent={onSaveContent}
          onBack={onBack}
          onFlushRef={onFlushRef}
          onSaveStateChange={onSaveStateChange}
          onRichEditorReady={setRichEditor}
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
  onSaveContent,
  onBack,
  onFlushRef,
  onSaveStateChange,
  onRichEditorReady
}: {
  page: Page
  breadcrumb?: string[]
  linkablePages?: Array<{ id: string; title: string }>
  onOpenPageLink?: (pageId: string) => void
  sourceField: 'html' | 'css' | 'javascript' | null
  onExitSource?: () => void
  onSaveContent?: (id: string, content: string) => Promise<boolean>
  onBack: () => void
  onFlushRef: (fn: (() => Promise<boolean>) | null) => void
  onSaveStateChange: (state: {
    isDirty: boolean
    saveState: 'clean' | 'saving' | 'saved' | 'error'
  }) => void
  onRichEditorReady: (editor: AnyRichEditor | null) => void
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
  if (page.pageType === 'diagram' || page.pageType === 'mindmap') {
    return (
      <Suspense fallback={<VisualWorkspaceSkeleton />}>
        <MermaidPageWorkspace
          key={page.id}
          pageId={page.id}
          storedContent={page.content}
          pageType={page.pageType}
          onSaveContent={onSaveContent}
          onFlushRef={onFlushRef}
          onSaveStateChange={onSaveStateChange}
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
      onSaveContent={onSaveContent}
      onBack={onBack}
      onFlushRef={onFlushRef}
      onSaveStateChange={onSaveStateChange}
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
  onSaveContent,
  onBack,
  onFlushRef,
  onSaveStateChange
}: {
  page: Page
  breadcrumb: string[]
  sourceField: 'html' | 'css' | 'javascript' | null
  onExitSource?: () => void
  onSaveContent?: (id: string, content: string) => Promise<boolean>
  onBack: () => void
  onFlushRef: (fn: (() => Promise<boolean>) | null) => void
  onSaveStateChange: (state: {
    isDirty: boolean
    saveState: 'clean' | 'saving' | 'saved' | 'error'
  }) => void
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
          onSaveContent={onSaveContent}
          breadcrumbLabels={[...breadcrumb, page.title]}
          onBack={onBack}
          onFlushRef={onFlushRef}
          onSaveStateChange={onSaveStateChange}
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
