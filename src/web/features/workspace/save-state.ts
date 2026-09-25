import type { AutosaveStatus } from '../rich-editor/autosave-controller.js'

/**
 * The save states the status bar knows how to display.
 *
 * `pending` is deliberately distinct from `clean`. Autosave is debounced, so
 * there is a window in which an edit exists but no save has run yet. Folding
 * that window into `clean` made the bar announce "Saved" for work that was
 * still only in memory, which is the one thing a save indicator must never do.
 */
export type StatusSaveState = 'clean' | 'pending' | 'saving' | 'saved' | 'error'

/**
 * The single translation from the autosave lifecycle to the displayed state.
 *
 * This existed in three copies — in the rich editor, the HTML editor and the
 * markdown workspace — and the copies had drifted. The rich editor *cast*
 * `AutosaveStatus` to the display type, so `'dirty'` and `'idle'` reached the
 * bar as values it does not recognise and fell through to "Saved". The markdown
 * workspace folded `'dirty'` into `'clean'`, with the same result. Only the HTML
 * editor mapped it correctly, so a Rich Note's status bar claimed "Saved" while
 * the edit was still pending, and a Markdown page did the same.
 *
 * Both defects were invisible to every test that existed, because each was
 * asserted against the copy that happened to be right.
 */
export function mapAutosaveStatus(status: AutosaveStatus): StatusSaveState {
  switch (status) {
    case 'saving':
      return 'saving'
    case 'saved':
      return 'saved'
    case 'error':
      return 'error'
    // An edit exists and no save has run yet. This is the whole point of the
    // separate state.
    case 'dirty':
      return 'pending'
    case 'idle':
      return 'clean'
  }
}

/**
 * Whether the autosave lifecycle currently holds work that is not yet written.
 *
 * Used for the close/switch confirmation, so it must agree with
 * {@link mapAutosaveStatus}: anything the bar calls unsaved counts as dirty.
 */
export function isAutosaveDirty(status: AutosaveStatus): boolean {
  return status === 'dirty' || status === 'saving'
}
