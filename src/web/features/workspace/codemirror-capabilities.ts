import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'

import {
  AVAILABLE,
  type Availability,
  type Capability,
  type CapabilityState,
  type EditorCapabilities,
  unavailable
} from './capabilities.js'
import {
  applyBlockPrefix,
  buildCallout,
  buildLink,
  buildTable,
  type EditRange,
  isWholeLineSelection,
  type LineSelection,
  toggleCodeFence,
  wrapInline,
  wrapInlinePerLine
} from './codemirror-markdown-actions.js'

/**
 * The CodeMirror adapter: what a Markdown Note can do, expressed as capabilities.
 *
 * ## Why this is an adapter and not a toolbar
 *
 * The first attempt was a React component that read the caret and dispatched
 * transactions itself. That put editor state in the view layer, made the
 * transforms untestable without a browser, and meant the control set was whatever
 * that component happened to render. Here the transforms are pure functions
 * (`codemirror-markdown-actions.ts`, which is where the reusable logic from the
 * deleted attempt now lives) and this file is only the mapping from a capability
 * to one of them.
 *
 * ## The unavailable set
 *
 * A capability Markdown genuinely lacks is declared `unavailable` with a reason
 * rather than omitted, for two reasons and the second is the important one: the
 * row must not reflow when the reader switches tabs, and a greyed control that
 * explains itself is more use than an absent one.
 */
const MARKDOWN_UNAVAILABLE: Readonly<Partial<Record<Capability, Availability>>> = {
  'color.text': unavailable('raw HTML is escaped by the renderer, so inline styles are dropped'),
  'color.highlight': unavailable(
    'raw HTML is escaped by the renderer, so inline styles are dropped'
  ),
  'mark.underline': unavailable('Markdown has no underline syntax'),
  'list.checklist': unavailable('Markdown task lists render, but one cannot be started from here'),
  /*
   * `insert.linkedPage` is deliberately absent from this record rather than
   * listed as unavailable.
   *
   * A Rich Note's linked page is a first-party block that stores a target id, and
   * there is no Markdown spelling for it — the renderer would show the literal
   * text. So the honest answer is that this surface has no such command, and the
   * shell renders it from the model's own fallback reason rather than this file
   * restating one. Listed here it would read as a Markdown limitation, which it
   * is not: it is a missing feature on this surface, and the two deserve
   * different wording.
   */
  'align.left': unavailable('Markdown has no alignment syntax'),
  'align.center': unavailable('Markdown has no alignment syntax'),
  'align.right': unavailable('Markdown has no alignment syntax'),
  'indent.outdent': unavailable('Markdown has no outdent syntax'),
  'indent.increase': unavailable('Markdown has no indent syntax'),
  'insert.diagram': unavailable('a diagram is a first-party block, not a Markdown construct'),
  'insert.image': unavailable('there is no image insert action on this surface'),
  'insert.document': unavailable(
    'a document embed is a first-party block, not a Markdown construct'
  )
}

/** The block markers this adapter knows, one per block capability. */
const BLOCK_MARKERS = {
  'block.heading1': '# ',
  'block.heading2': '## ',
  'block.heading3': '### ',
  'list.bullet': '- ',
  'list.numbered': '1. '
} as const satisfies Partial<Record<Capability, string>>

/** The prefix that identifies each block capability, for the pressed state. */
const BLOCK_PREFIXES = {
  'block.heading1': '#',
  'block.heading2': '##',
  'block.heading3': '###',
  'list.bullet': '-',
  'list.numbered': '1.'
} as const satisfies Partial<Record<Capability, string>>

/**
 * The inline delimiters, one per mark capability.
 *
 * A capability absent from this record has no delimiter, which is how
 * `mark.underline` is expressed: Markdown has no underline syntax, so it is
 * listed in `MARKDOWN_UNAVAILABLE` rather than given an empty delimiter that a
 * reader would have to notice was empty.
 */
const INLINE_DELIMITERS = {
  'mark.bold': '**',
  'mark.italic': '*',
  'mark.strikethrough': '~~',
  'insert.formula': '$'
} as const satisfies Partial<Record<Capability, string>>

/** Callout directive per capability, from the names `markdown-render.ts` parses. */
const CALLOUT_DIRECTIVES = {
  'insert.calloutInfo': 'info',
  'insert.calloutNote': 'note',
  'insert.calloutTip': 'tip',
  'insert.calloutWarning': 'warning',
  'insert.calloutDanger': 'danger'
} as const satisfies Partial<Record<Capability, string>>

/** The selection as whole lines, or null when it starts or ends mid-line. */
function wholeLineSelection(view: EditorView): LineSelection | null {
  const { from, to } = view.state.selection.main
  /*
   * Clamped to the document, because `lineAt` throws on an out-of-range position
   * and this reader runs on every render of every Markdown page.
   *
   * Measured: `RangeError: Invalid position 1 in document of length 0`, thrown from
   * this function while `DocumentToolbar` asked for live state, which took the
   * whole toolbar row down — the view switch rendered zero buttons. The document was
   * empty, and a selection reported an end position past its end.
   *
   * Clamping is the honest fix rather than a try/catch around the reader: an
   * out-of-range selection is a fact about a moment in time, and collapsing it to
   * the document's bounds is the truth about that moment. A catch would have hidden
   * any *other* error in this reader behind "state unavailable", which is how a real
   * defect would disappear.
   */
  const max = view.state.doc.length
  const start = Math.min(Math.max(from, 0), max)
  const end = Math.min(Math.max(to, 0), max)
  const startLine = view.state.doc.lineAt(start)
  const endLine = view.state.doc.lineAt(end)
  const selection: LineSelection = {
    fromLine: startLine.number,
    toLine: endLine.number,
    fromColumn: start - startLine.from,
    toColumn: end - endLine.from,
    // The end of the last line's text, so a selection that runs to the end of a
    // line counts as covering it. Without this, `isWholeLineSelection` compares
    // the end column against zero and rejects every select-all.
    toLineLength: endLine.text.length
  }
  return isWholeLineSelection(selection) ? selection : null
}

/**
 * The document range covering a set of whole lines, and the text in it.
 *
 * `to` is the end of the last line's *content*, not the start of the next line,
 * so a replacement does not swallow the newline that follows the block. Getting
 * this wrong is silent: the document still parses, it just loses a line break.
 */
function readLines(view: EditorView, selection: LineSelection): EditRange {
  const first = view.state.doc.lineAt(selection.fromLine)
  const last = view.state.doc.lineAt(selection.toLine)
  const from = first.from
  const to = last.from + last.text.length
  return {
    fromLine: selection.fromLine,
    toLine: selection.toLine,
    text: view.state.doc.toString().slice(from, to)
  }
}

/** Replaces a line range with new text, as one transaction, then refocuses. */
function writeLines(view: EditorView, range: EditRange, next: readonly string[]): void {
  const first = view.state.doc.lineAt(range.fromLine)
  const last = view.state.doc.lineAt(range.toLine)
  view.dispatch({
    changes: { from: first.from, to: last.from + last.text.length, insert: next.join('\n') }
  })
  view.focus()
}

/** Inserts text at the caret, as one transaction, then refocuses. */
function writeAtCaret(view: EditorView, insert: string): void {
  const { from } = view.state.selection.main
  view.dispatch({ changes: { from, to: from, insert } })
  view.focus()
}

type LiveView = () => EditorView | null

/**
 * Builds the capability record for a Markdown Note.
 *
 * `getView` is a function rather than a view because the editor mounts after the
 * toolbar renders, and Preview mode has no view at all — Preview still shows the
 * bar, and its commands act on the source. Reading the view through a call means
 * a missing view is a null to handle rather than a stale object to act on.
 */
export function createMarkdownCapabilities(getView: LiveView): EditorCapabilities {
  const commands: Partial<Record<Capability, () => void>> = {}

  // Undo and redo are CodeMirror's own, from the same module the editor's
  // keymap already uses. Reimplementing them would mean a second history.
  commands['history.undo'] = () => {
    const view = getView()
    if (view) undo(view)
  }
  commands['history.redo'] = () => {
    const view = getView()
    if (view) redo(view)
  }

  // Block markers: one code path, so a toggle cannot drift between capabilities.
  for (const [capability, marker] of Object.entries(BLOCK_MARKERS) as Array<[Capability, string]>) {
    commands[capability] = () => {
      const view = getView()
      if (!view) return
      const selection = wholeLineSelection(view)
      if (!selection) return
      const range = readLines(view, selection)
      const lines = range.text.split('\n')
      const active = lines.every((line) => line.trimStart().startsWith(marker.trim()))
      writeLines(view, range, applyBlockPrefix(lines, marker, active))
    }
  }

  // Inline delimiters: the same code path, differing only in the delimiter. The
  // caller states the full delimiter because `*` and `**` are different marks and
  // a token this function doubled could not tell them apart.
  for (const [capability, delimiter] of Object.entries(INLINE_DELIMITERS) as Array<
    [Capability, string]
  >) {
    commands[capability] = () => {
      const view = getView()
      if (!view) return
      const { from, to } = view.state.selection.main
      const text = view.state.doc.toString().slice(from, to)
      // Strikethrough behaves per line in practice: a `~~` span across a blank
      // line is not emphasis at all, so wrapping the whole selection would
      // produce text that renders differently from what the button promised.
      const next =
        capability === 'mark.strikethrough'
          ? wrapInlinePerLine(text, delimiter)
          : wrapInline(text, delimiter)
      view.dispatch({ changes: { from, to, insert: next } })
      view.focus()
    }
  }

  commands['link.insert'] = () => {
    const view = getView()
    if (!view) return
    const { from, to } = view.state.selection.main
    const text = view.state.doc.toString().slice(from, to)
    view.dispatch({ changes: { from, to, insert: buildLink(text, '') } })
    view.focus()
  }

  commands['insert.quote'] = () => {
    const view = getView()
    if (!view) return
    const selection = wholeLineSelection(view)
    if (!selection) return
    const range = readLines(view, selection)
    writeLines(view, range, applyBlockPrefix(range.text.split('\n'), '> ', false))
  }

  /*
   * Paragraph: strips whatever block marker is on the line, which is what
   * "make this a paragraph" means in Markdown. There is no prefix to add, so it
   * is the same transform as clear-formatting but scoped to the block layer —
   * it leaves inline marks alone, where `format.clear` also does, and the
   * difference is that this one is the paragraph *control* rather than the
   * catch-all.
   */
  commands['block.paragraph'] = () => {
    const view = getView()
    if (!view) return
    const selection = wholeLineSelection(view)
    if (!selection) return
    const range = readLines(view, selection)
    writeLines(view, range, applyBlockPrefix(range.text.split('\n'), '', false))
  }

  /*
   * Code block: a fence, not an inline span. Distinct from `insert.formula` and
   * from the inline-code path because a fence is a whole-line construct, so it
   * goes through the line transform rather than the selection wrap.
   */
  commands['insert.codeBlock'] = () => {
    const view = getView()
    if (!view) return
    const selection = wholeLineSelection(view)
    if (!selection) return
    const range = readLines(view, selection)
    writeLines(view, range, toggleCodeFence(range.text.split('\n')))
  }

  commands['insert.table'] = () => {
    const view = getView()
    if (!view) return
    const selection = wholeLineSelection(view)
    if (!selection) return
    const range = readLines(view, selection)
    writeLines(view, range, buildTable(['Column 1', 'Column 2']))
  }

  for (const [capability, directive] of Object.entries(CALLOUT_DIRECTIVES) as Array<
    [Capability, string]
  >) {
    commands[capability] = () => {
      const view = getView()
      if (!view) return
      writeAtCaret(view, buildCallout(directive, 'Note').join('\n'))
    }
  }

  commands['format.clear'] = () => {
    const view = getView()
    if (!view) return
    const selection = wholeLineSelection(view)
    if (!selection) return
    const range = readLines(view, selection)
    // An empty marker is the "strip whatever block prefix is there" case, which
    // is what `applyBlockPrefix` already implements for a toggle.
    writeLines(view, range, applyBlockPrefix(range.text.split('\n'), '', false))
  }

  /**
   * The live state, recomputed on demand.
   *
   * Returned as one record rather than read per control, so the toolbar performs
   * one read per render. It reports two things a static record could not: a block
   * control is unavailable on a partial-line selection, and a block control is
   * pressed when the caret already sits inside that kind of block.
   */
  const state = (): Partial<Record<Capability, CapabilityState>> => {
    const live: Partial<Record<Capability, CapabilityState>> = {}

    // The unavailable set is copied in first, so a capability that never has a
    // command is still reported — the shell needs the reason either way, and a
    // capability with no command is dropped before the reason could be read.
    for (const [capability, reason] of Object.entries(MARKDOWN_UNAVAILABLE) as Array<
      [Capability, Availability]
    >) {
      live[capability] = { available: reason }
    }

    const view = getView()
    if (!view) return live
    const selection = wholeLineSelection(view)

    for (const capability of Object.keys(BLOCK_MARKERS) as Capability[]) {
      if (!selection) {
        // A partial-line selection cannot become a block without splitting the
        // paragraph, so the control says so instead of doing something else.
        live[capability] = {
          available: unavailable('select whole lines to change the block type')
        }
        continue
      }
      const prefix = BLOCK_PREFIXES[capability as keyof typeof BLOCK_PREFIXES]
      const first = view.state.doc.lineAt(selection.fromLine).text
      live[capability] = { active: first.trimStart().startsWith(prefix) }
    }

    /*
     * Paragraph is the *absence* of a block marker, so it cannot be answered by
     * the loop above: there is no prefix to match. It is the complement of every
     * prefix in `BLOCK_PREFIXES`, and it is reported here rather than left
     * undefined so the control shows as pressed on a plain line — which is what
     * makes the block group a radio group a reader can read at a glance.
     */
    if (selection) {
      const first = view.state.doc.lineAt(selection.fromLine).text.trimStart()
      const isPlain = !Object.values(BLOCK_PREFIXES).some((prefix) => first.startsWith(prefix))
      live['block.paragraph'] = { active: isPlain }
    }

    for (const [capability, delimiter] of Object.entries(INLINE_DELIMITERS) as Array<
      [Capability, string]
    >) {
      const { from, to } = view.state.selection.main
      const text = view.state.doc.toString().slice(from, to)
      live[capability] = {
        active:
          text.length >= delimiter.length * 2 &&
          text.startsWith(delimiter) &&
          text.endsWith(delimiter)
      }
    }

    // Undo and redo report themselves unavailable at the ends of the history,
    // which is what makes a greyed undo read as "nothing to undo" rather than
    // "this is a broken button".
    live['history.undo'] = { available: undoable(view) }
    live['history.redo'] = { available: redoable(view) }

    return live
  }

  return { commands, state }
}

/**
 * Whether the history has something to undo, and if not, says so.
 *
 * `undoDepth` is CodeMirror's own count of undoable events, so this is the same
 * number the `undo` command consults — not a second history tracked here, which
 * could disagree with the first. A greyed undo that reads "nothing to undo" is
 * the difference between an unavailable command and a broken button.
 */
function undoable(view: EditorView): Availability {
  return undoDepth(view.state) > 0 ? AVAILABLE : unavailable('nothing to undo')
}

/** As {@link undoable}, for the redo direction. */
function redoable(view: EditorView): Availability {
  return redoDepth(view.state) > 0 ? AVAILABLE : unavailable('nothing to redo')
}
