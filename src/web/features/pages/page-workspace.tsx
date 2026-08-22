import { Box, Skeleton, Stack, Text } from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { parseHtmlContent } from '@rtwiki/shared/schemas/html-content'
import { lazy, Suspense } from 'react'
import { HtmlPlaceholder } from '../html/html-placeholder.js'
import { HtmlEditorErrorBoundary } from '../html-editor/html-editor-error-boundary.js'
import { RichEditor } from '../rich-editor/rich-editor.js'
import { EditorHeader } from './editor-header.js'
import { PageTab } from './page-tab.js'
import classes from './page-workspace.module.css'

// CodeMirror is heavy and only needed on HTML pages — loaded as its own chunk.
const HtmlEditorWorkspace = lazy(() => import('../html-editor/html-editor.js'))

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
  onRename: (title: string) => Promise<boolean>
  onDuplicate: () => void
  onDelete: () => void
  onFlushRef: (fn: (() => Promise<boolean>) | null) => void
  onSaveStateChange: (state: {
    isDirty: boolean
    saveState: 'clean' | 'saving' | 'saved' | 'error'
  }) => void
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
  onRename,
  onDuplicate,
  onDelete,
  onFlushRef,
  onSaveStateChange
}: PageWorkspaceProps): JSX.Element {
  return (
    <div className={classes.workspace}>
      <PageTab page={page} onClose={onBack} />

      <EditorHeader
        page={page}
        isDirty={isDirty}
        saveState={saveState}
        onSave={onSave}
        onRetry={onRetry}
        onBack={onBack}
        onRename={onRename}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />

      {breadcrumb.length > 0 ? (
        <Text size="xs" c="dimmed" aria-label="Page location" data-testid="page-breadcrumb">
          {breadcrumb.join(' / ')}
        </Text>
      ) : null}
      <div className={classes.content}>
        {page.pageType === 'rich' ? (
          <RichEditor
            pageId={page.id}
            storedContent={page.content}
            pageTitle={page.title}
            onSaveContent={onSaveContent}
            onBack={onBack}
            onFlushRef={onFlushRef}
            onSaveStateChange={onSaveStateChange}
          />
        ) : (
          <HtmlEditorSurface
            page={page}
            onSaveContent={onSaveContent}
            onBack={onBack}
            onFlushRef={onFlushRef}
            onSaveStateChange={onSaveStateChange}
          />
        )}
      </div>
    </div>
  )
}

/**
 * HTML-page surface. Malformed stored content keeps the placeholder — it is
 * never overwritten and never silently "fixed". Valid content (v1 or v2)
 * opens the lazily loaded editable workspace with its live preview.
 */
function HtmlEditorSurface({
  page,
  onSaveContent,
  onBack,
  onFlushRef,
  onSaveStateChange
}: {
  page: Page
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
          onSaveContent={onSaveContent}
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
