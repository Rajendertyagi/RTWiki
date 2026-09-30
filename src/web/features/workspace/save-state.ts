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
 * {@link mapAutosaveStatus} on every state the bar calls `pending`, `saving` or
 * `error`.
 *
 * Note that agreement is *not* equivalence with "the bar is not saying Clean".
 * `saved` is a fourth bar state meaning a write just completed, and it is
 * correctly not dirty; the bar distinguishes it from `clean` because that is worth
 * showing, not because anything is unwritten.
 *
 * ## Why `error` is in here
 *
 * A failed save leaves the content in memory and unwritten, so it is unsaved work
 * by the definition above. The previous `dirty || saving` did not count it, which
 * meant the one state where content is genuinely at risk was the one state a close
 * confirmation treated as safe. The autosave controller keeps its payload for
 * retry precisely so that state is recoverable — and it can only be recovered
 * while the page is still mounted.
 *
 * This is now the **only** definition: `useAutosave` used to compute its own
 * `dirty || error`, which was a second convention that happened to be closer to
 * the truth while still disagreeing about a save in flight. Two spellings of one
 * question is how the disagreement happened in the first place.
 */
export function isAutosaveDirty(status: AutosaveStatus): boolean {
  return status === 'dirty' || status === 'saving' || status === 'error'
}
