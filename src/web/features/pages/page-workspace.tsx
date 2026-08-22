import type { Page } from '@rtwiki/shared/contracts/pages'
import { HtmlPlaceholder } from '../html/html-placeholder.js'
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
          <HtmlPlaceholder />
        )}
      </div>
    </div>
  )
}
