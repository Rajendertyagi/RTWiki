import { Stack } from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import type { MutationStatus } from '../../hooks/use-pages-controller.js'
import { HtmlPlaceholder } from '../html/html-placeholder.js'
import { RichEditor } from '../rich-editor/rich-editor.js'
import { EditorHeader } from './editor-header.js'
import { PageTab } from './page-tab.js'
import classes from './page-workspace.module.css'

interface PageWorkspaceProps {
  page: Page
  mutationStatus: MutationStatus
  onBack: () => void
  onRename: (title: string) => Promise<boolean>
  onDuplicate: () => void
  onDelete: () => void
  onFlushRef: (fn: (() => Promise<boolean>) | null) => void
}

export function PageWorkspace({
  page,
  mutationStatus,
  onBack,
  onRename,
  onDuplicate,
  onDelete,
  onFlushRef
}: PageWorkspaceProps): JSX.Element {
  return (
    <div className={classes.workspace}>
      <PageTab page={page} onClose={onBack} />

      <EditorHeader
        page={page}
        mutationStatus={mutationStatus}
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
            onFlushRef={onFlushRef}
          />
        ) : (
          <HtmlPlaceholder />
        )}
      </div>
    </div>
  )
}
