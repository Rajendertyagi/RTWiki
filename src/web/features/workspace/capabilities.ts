/**
 * The capability model every editor surface answers.
 *
 * ## Why capabilities and not `pageType === 'markdown'` conditionals
 *
 * The first attempt at a Markdown toolbar decided what to render with a chain
 * of `pageType` comparisons inside the toolbar component. That shape has three
 * defects, all of which bit during the attempt that produced it:
 *
 * 1. It cannot express *why* a control is unavailable, so a greyed button could
 *    not explain itself.
 * 2. Adding a surface meant editing the component, so the knowledge of what
 *    each editor can do spread across the view layer.
 * 3. It had nowhere to put a control that only some surfaces have, so the
 *    control set was whichever set the component happened to be written for.
 *
 * A capability is the inverse: the **editor** declares what it can do, and the
 * toolbar renders whatever it is given. Nothing in this module knows that
 * Markdown exists.
 */

import type { ReactNode } from 'react'

/**
 * One document-editing capability, named by what the reader would call it.
 *
 * These are deliberately *semantic* rather than syntactic. "Heading 2" is a
 * capability; "prefix the line with `## `" is not, because only one surface
 * implements that particular spelling and the toolbar has no business knowing
 * it.
 */
export type Capability =
  | 'history.undo'
  | 'history.redo'
  | 'block.paragraph'
  | 'block.heading1'
  | 'block.heading2'
  | 'block.heading3'
  | 'mark.bold'
  | 'mark.italic'
  | 'mark.underline'
  | 'mark.strikethrough'
  | 'color.text'
  | 'color.highlight'
  | 'link.insert'
  | 'list.bullet'
  | 'list.numbered'
  | 'list.checklist'
  | 'align.left'
  | 'align.center'
  | 'align.right'
  | 'indent.outdent'
  | 'indent.increase'
  | 'format.clear'
  | 'insert.formula'
  | 'insert.diagram'
  | 'insert.linkedPage'
  | 'insert.image'
  | 'insert.document'
  | 'insert.table'
  | 'insert.codeBlock'
  | 'insert.quote'
  | 'insert.calloutInfo'
  | 'insert.calloutNote'
  | 'insert.calloutTip'
  | 'insert.calloutWarning'
  | 'insert.calloutDanger'
  /*
   * The HTML/CSS/JavaScript source editor.
   *
   * A prefix rather than bare names, because a source editor has no blocks, no
   * inline marks and no colours — every one of those would be wrong for it — and
   * because the prefix keeps these visibly a different family from the document
   * controls when both live in the same model.
   */
  | 'ide.find'
  | 'ide.replace'
  | 'ide.comment'
  | 'ide.indent'
  | 'ide.outdent'
  | 'ide.format'
  | 'ide.wordWrap'
  | 'ide.foldAll'
  | 'ide.unfoldAll'
  | 'ide.fontSmaller'
  | 'ide.fontReset'
  | 'ide.fontLarger'
  | 'ide.saveNow'
  | 'ide.fullscreen'
  /*
   * The HTML page's Preview / HTML / CSS / JS switch.
   *
   * These were a `SegmentedControl` rendered as a **sibling** of the toolbar, inside a
   * `Group` the page published upward. That is the whole defect: they sat beside the
   * application toolbar rather than inside it, so they were outside its
   * `role="toolbar"`, outside its roving focus and its overflow, and their presence in a
   * `justify="space-between"` group is why the bar itself measured 683px in a 1600px
   * row. As capabilities they become ordinary toolbar controls and the layout problem
   * disappears on its own.
   *
   * Four toggles rather than one control with a panel, because exactly one is active at
   * a time and each is a destination — the toolbar already has the pressed/active model
   * for that, and a panel would put four choices behind a fifth control for no gain.
   */
  | 'html.fieldPreview'
  | 'html.fieldHtml'
  | 'html.fieldCss'
  | 'html.fieldJs'
  /*
   * Rebuilding the rendered preview.
   *
   * Declared as a capability rather than kept as a hand-built button beside the
   * bar. It was a bare `Button` inside a `Group` the HTML page published upward,
   * which is the same shape that made the preview's toolbar a second toolbar:
   * outside the shared shell's `role="toolbar"`, its roving focus and its
   * overflow, and rendered by the one surface that hand-built chrome.
   */
  | 'html.refreshPreview'

/**
 * Whether a control can act, and if not, why.
 *
 * A discriminated union rather than two optional fields, so `availability.reason`
 * is only reachable after `availability.available === false`. With two optional
 * fields a caller could write `{ reason: 'x' }`, forget `available`, and produce
 * the one state the shell cannot render: a control that is neither usable nor
 * able to say why not.
 */
export type Availability =
  | { readonly available: true }
  | {
      readonly available: false
      /**
       * Sentence fragment, no trailing period. The shell composes
       * `<label> — <reason>` so one phrasing serves every surface and the reason
       * cannot disagree with the label it is attached to.
       */
      readonly reason: string
    }

/** The shared "it can act" answer. A constant so it is one object, not one per call. */
export const AVAILABLE: Availability = { available: true }

/**
 * Declares a capability as unavailable, with the reason shown to the reader.
 *
 * The reason is a required parameter rather than a default so a caller cannot
 * disable a control and leave it unexplained. Writing `unavailable('…')` at each
 * site also puts the explanation next to the decision, where a reader of that
 * file can check it.
 */
export function unavailable(reason: string): Availability {
  return { available: false, reason }
}

/**
 * What an editor surface tells the toolbar.
 *
 * Two parts, and the split is the point:
 *
 * - `capabilities` is the **static** answer: which commands this surface has at
 *   all. It does not change as the caret moves.
 * - `state` is the **live** answer: which of them can act *right now*, which is
 *   what a caret-dependent answer is for.
 *
 * Collapsing them is what produced a toolbar that re-rendered on every caret
 * move and appeared to change width. Splitting them means the control *set* is
 * computed once per surface while only the pressed/disabled state updates.
 */
export interface EditorCapabilities {
  /**
   * Capabilities this surface implements, and the command that runs each.
   *
   * A capability absent from this record is one the surface does not have; the
   * toolbar omits nothing on its own account, it renders what it is handed.
   *
   * A capability may appear here *and* in `menus`, in which case the command is
   * not run on click: the control opens its panel instead. That is the case for
   * every popover-backed control — text colour, highlight, link — where the
   * button's job is to reveal choices, not to act.
   */
  readonly commands: Readonly<Partial<Record<Capability, EditorCommand>>>

  /**
   * Capabilities that open a panel instead of acting on click, and the panel's
   * contents.
   *
   * Separate from `commands` rather than a flag on a command, because a
   * menu-only capability has **no command at all**: text colour does nothing
   * until a colour is chosen. A flag on a required command could not express
   * that, and an earlier version of this contract had no way to say it, so a
   * menu-only control was dropped by the shell's "no command and no stated
   * unavailability" rule — measured, because that is precisely the shape text
   * colour has.
   */
  readonly menus?: Readonly<Partial<Record<Capability, EditorMenu>>>

  /**
   * Live per-capability state, recomputed when the editor's own state changes.
   *
   * Returned as a whole record rather than read through a subscription so a
   * surface can compute it however is natural — BlockNote has `useEditorState`,
   * CodeMirror has a `ViewUpdate` listener — without the toolbar knowing which.
   */
  readonly state: () => Readonly<Partial<Record<Capability, CapabilityState>>>
}

/**
 * A panel a capability opens, supplied by the surface and hosted by the shell.
 *
 * ## Why the surface supplies contents rather than a rendered element
 *
 * The shell owns the trigger, the tooltip, the availability, the roving order and
 * the panel's own open/close state. The surface supplies only what is genuinely
 * editor-specific — a colour grid, a URL field, a template list. That split is
 * what stops a surface from becoming a second toolbar: it cannot render a
 * trigger, so it cannot add a control, and it cannot own the panel's dismissal,
 * so it cannot strand one open.
 */
export interface EditorMenu {
  /**
   * The panel's contents.
   *
   * Given a `close` callback because a panel that acts must be able to dismiss
   * itself. The colour grid is the case in point: choosing a colour has to close
   * the popover and return focus to the editor, and a bare `ReactNode` with no
   * way to close is why the earlier seam was structurally unusable.
   */
  readonly content: (close: () => void) => ReactNode
}

/**
 * The live state of one capability.
 *
 * `available: false` here is a *transient* unavailability — a command that
 * exists on this surface but cannot act at the caret — and it is distinct from
 * the capability being absent from `commands` entirely. Both render the same
 * way, and both must carry a reason, but they mean different things and a
 * future diagnostic needs to tell them apart.
 */
export interface CapabilityState {
  /** Whether the command can act now. Absent means it can. */
  readonly available?: Availability
  /** Whether the command is currently in effect at the caret (a toggle on). */
  readonly active?: boolean
  /**
   * Replaces the model's label, for a control whose name changes with its state.
   *
   * Needed for exactly one case so far: fullscreen reads "Enter fullscreen" or
   * "Exit fullscreen" depending on where it is, which is the honest thing to
   * announce and which a static model label cannot express.
   *
   * It is a narrow escape hatch, not a general one. The label still comes from the
   * central dictionary — a surface supplies text from `UI_TEXT`, never a literal —
   * and a control that needs no dynamic name leaves this unset.
   */
  readonly label?: string
}

/** Narrows an {@link Availability} to its unavailable arm. */
export function isUnavailable(availability: Availability): boolean {
  return availability.available === false
}

/** Runs one capability against the editor that owns it. */
export type EditorCommand = () => void

/**
 * Merges the static command set with the live state into the single answer the
 * toolbar renders.
 *
 * A capability present in `commands` but reporting itself unavailable stays in
 * the control set, greyed — it is not dropped. That is deliberate: the row must
 * not reflow when the caret moves onto a line where, say, outdent has nothing
 * to outdent, or the toolbar would jump under the pointer. Only a capability the
 * surface does not implement at all is absent.
 */
export function resolveControlAvailability(
  capabilities: EditorCapabilities,
  capability: Capability
): { command: EditorCommand; state: CapabilityState } | null {
  const command = capabilities.commands[capability]
  if (!command) return null
  return { command, state: capabilities.state()[capability] ?? {} }
}
