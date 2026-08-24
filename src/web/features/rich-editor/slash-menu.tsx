import { combineByGroup, filterSuggestionItems } from '@blocknote/core'
import { getMathSlashMenuItems } from '@blocknote/math-block'
import { getDefaultReactSlashMenuItems, SuggestionMenuController } from '@blocknote/react'
import type { JSX } from 'react'
import { useMemo } from 'react'
import { getInsertEntries, runInsertEntry } from './insert-blocks.js'
import type { AnyRichEditor } from './schema.js'

/**
 * The Rich Document slash menu: BlockNote's default items plus the official
 * math items plus RTWiki's visual-knowledge insertions. Entries are shared
 * with the toolbar Insert menu via insert-blocks.ts so both surfaces stay
 * identical by construction.
 */
export function getRTWikiSlashMenuItems(
  editor: AnyRichEditor
): ReturnType<typeof getDefaultReactSlashMenuItems> {
  const defaults = getDefaultReactSlashMenuItems(editor)
  const mathItems = getMathSlashMenuItems(editor)
  const insertItems = getInsertEntries(editor).map((entry) => ({
    title: entry.label,
    subtext: entry.group === 'callout' ? undefined : undefined,
    group: entry.group === 'callout' ? 'Callouts' : 'Insert',
    onItemClick: () => {
      runInsertEntry(editor, entry)
    },
    aliases: [entry.key]
  }))
  // Grouped composition keeps BlockNote's default ordering intact while the
  // visual blocks form their own groups directly after the defaults.
  return [...combineByGroup(defaults, mathItems), ...insertItems]
}

/**
 * Renders the slash menu inside a BlockNoteView. Drop this component as a
 * child of BlockNoteView to enable "/" insertions with the RTWiki entries.
 */
export function RTSuggestionMenu({ editor }: { editor: AnyRichEditor }): JSX.Element {
  const getItems = useMemo(() => {
    const items = getRTWikiSlashMenuItems(editor)
    return async (query: string) => filterSuggestionItems(items, query)
  }, [editor])
  return <SuggestionMenuController triggerCharacter="/" getItems={getItems} />
}
