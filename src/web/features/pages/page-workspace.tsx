import type { Page } from '@rtwiki/shared/contracts/pages'
import { parseHtmlContent } from '@rtwiki/shared/schemas/html-content'
import { HtmlPlaceholder } from '../html/html-placeholder.js'
import { PreviewFrame } from '../html/preview-frame.js'
import { RichEditor } from '../rich-editor/rich-editor.js'
import { EditorHeader } from './editor-header.js'
import { PageTab } from './page-tab.js'
import classes from './page-workspace.module.css'

interface PageWorkspaceProps {
  page: Page
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
          <HtmlPreviewOrPlaceholder storedContent={page.content} />
        )}
      </div>
    </div>
  )
}

/**
 * Renders the sandboxed preview for canonical HTML-page content. Stored
 * content that predates canonical validation (or is malformed) keeps the
 * placeholder — it is never overwritten and never silently "fixed".
 */
function HtmlPreviewOrPlaceholder({ storedContent }: { storedContent: string }): JSX.Element {
  const parsed = parseHtmlContent(storedContent)
  if (!parsed.ok) {
    return <HtmlPlaceholder />
  }
  return <PreviewFrame content={parsed.content} />
}
