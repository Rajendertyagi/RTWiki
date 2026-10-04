import { useCallback, useMemo } from 'react'

import { DocumentToolbar } from '../workspace/document-toolbar.js'
import { type InsertEntryLike, useRichCapabilities } from './blocknote-capabilities.js'
import { getInsertEntries, runInsertEntry } from './insert-blocks.js'
import type { AnyRichEditor } from './schema.js'
import type { LinkablePage } from './wiki-link.js'

export interface RichToolbarBridgeProps {
  editor: AnyRichEditor
  linkablePages: LinkablePage[]
}

/**
 * The bridge from the Rich Note editor to the unified toolbar.
 *
 * ## Why this file exists
 *
 * `useRichCapabilities` is a hook, so it cannot be called from
 * `page-workspace.tsx` — that component does not own the editor, it only receives
 * a readiness callback. And the editor itself must not render the toolbar: it
 * does not know a toolbar exists, which is the property that keeps BlockNote's
 * chrome out of the application.
 *
 * So this is the one place both facts are true: it holds the editor, calls the
 * adapter hook, and renders the shared shell. It draws no control of its own.
 *
 * ## Why it is not lazy-loaded separately
 *
 * It is loaded as part of `rich-editor.js`, which `page-workspace.tsx` already
 * lazy-loads. Verified in the built output: neither this file nor BlockNote
 * appears in the eager entry chunk. The toolbar shell itself is a separate lazy
 * chunk, so a page that never opens a Rich Note never loads either.
 */
export function RichToolbarBridge({
  editor,
  linkablePages
}: RichToolbarBridgeProps): React.ReactElement {
  /*
   * The insert entries, read once per editor.
   *
   * `getInsertEntries(editor)` walks the registry and builds objects, so calling
   * it on every render would hand `useRichCapabilities` a new array each time and
   * invalidate every `useMemo` inside the adapter. The entries depend only on the
   * editor, so they are read when the editor changes.
   */
  const insertEntries = useMemo(() => getInsertEntries(editor), [editor])
  const runEntry = useCallback(
    (entry: InsertEntryLike) => runInsertEntry(editor, entry as never),
    [editor]
  )

  /*
   * The diagram insertion, bound to the editor.
   *
   * The registry's diagram entry deliberately has no `insert` — it has a
   * `submenu` of templates and an `insertSource(editor, content)`. So the chooser
   * resolves a source and this callback turns one into a block. Both come from the
   * registry rather than from here, which is what keeps one definition of "insert a
   * Mermaid diagram" in the application.
   */
  const insertDiagramSource = useCallback(
    (source: string) => {
      const entry = insertEntries.find((candidate) => candidate.key === 'insert-diagram')
      const insertSource = entry?.insertSource
      if (!insertSource) return
      /*
       * Focus first, then insert.
       *
       * Every inserter in the registry reads `editor.getTextCursorPosition()`,
       * which throws when there is no cursor. Choosing a template happens behind a
       * panel in the toolbar row, so DOM focus is on a button and the editor may
       * have no selection. Measured: the option was visible and clicked, nothing
       * was inserted, and no error surfaced — the throw happened inside the
       * inserter, after the panel had closed.
       *
       * Refocusing is not a workaround. Every other toolbar action in the adapter
       * already focuses before it acts, for the same reason.
       */
      editor.focus()
      insertSource(editor, source)
    },
    [editor, insertEntries]
  )

  const capabilities = useRichCapabilities({
    editor,
    linkablePages,
    insertEntries,
    runInsertEntry: runEntry,
    insertDiagramSource,
    hasLinkTarget: linkablePages.length > 0
  })

  return <DocumentToolbar capabilities={capabilities} />
}
