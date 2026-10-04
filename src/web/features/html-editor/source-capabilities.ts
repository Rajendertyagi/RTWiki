import {
  indentLess,
  indentMore,
  redo,
  redoDepth,
  toggleComment,
  undo,
  undoDepth
} from '@codemirror/commands'
import { foldAll, unfoldAll } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'

import { UI_TEXT } from '../../config/index.js'
import {
  AVAILABLE,
  type Capability,
  type CapabilityState,
  type EditorCapabilities,
  unavailable
} from '../workspace/capabilities.js'

/**
 * The command adapter for the HTML/CSS/JavaScript source editors.
 *
 * ## What this replaces
 *
 * `source-toolbar.tsx` was a second toolbar: its own `role="toolbar"`, its own
 * `ActionIcon`s, its own `Tooltip`s, its own dividers, and no roving focus — every
 * one of its 17 controls was its own tab stop. It is the same defect
 * `rich-toolbar.tsx` had, in a feature nobody had migrated yet.
 *
 * This module keeps the seventeen *commands* and drops every pixel of chrome. The
 * row, the dividers, the tooltips, the one-tab-stop focus model and the overflow
 * all belong to `DocumentToolbar`.
 *
 * ## The seventeen, and where each one went
 *
 * Two are reused from the existing model rather than redeclared, because they are
 * genuinely the same actions on every surface: `history.undo` and `history.redo`.
 *
 * The rest become `ide.*` capabilities, because a source editor has no blocks, no
 * inline marks and no colours — reusing a document capability here would have been
 * a lie about what the control does. That includes indent and outdent: the Rich
 * Note's `indent.increase` is BlockNote's `nestBlock`, which is a different action
 * from CodeMirror's `indentMore`. Declaring them separately is what stops the
 * control from appearing twice in the model, which the model invariant test catches.
 *
 * ## Availability
 *
 * Undo and redo read CodeMirror's own `undoDepth`/`redoDepth`, so a greyed undo
 * means "nothing to undo" rather than "a broken button". Font size reports its own
 * bounds the way the old bar did, with native `disabled` plus a reason.
 */

/** What every view of the page can do, editor or not. */
interface SourceNavigationActions {
  /**
   * The field currently shown, and how to change it.
   *
   * These four were a `SegmentedControl` rendered as a **sibling** of the toolbar,
   * published upward inside a `Group`. They are capabilities now, so they sit inside the
   * application's `role="toolbar"`, share its roving focus and its overflow, and are
   * pinned to the row's right edge by the model's `align: 'end'` rather than by a
   * `justify="space-between"` arrangement that left 900px of unexplained gap.
   */
  field: 'preview' | 'html' | 'css' | 'javascript'
  onFieldChange: (field: 'preview' | 'html' | 'css' | 'javascript') => void
  /** Rebuilds the rendered preview from the stored HTML, CSS and JS. */
  onRefreshPreview: () => void
}

/**
 * What an open subfile editor can do.
 *
 * A discriminated union with {@link SourcePreviewActions} rather than one
 * interface with optional members, because "there is no editor on this view" is
 * a permanent fact about the preview, not a value that happens to be missing
 * this render. With optionals the preview call site would compile while
 * forgetting every editor action, and the honest answer would have nowhere to
 * be written down.
 */
export interface SourceEditingActions extends SourceNavigationActions {
  hasEditor: true
  /** The live CodeMirror view, or null before the editor mounts. */
  getView: () => EditorView | null
  /** Runs the lazily loaded Prettier build over the document. */
  onFormat: () => void
  wordWrap: boolean
  onToggleWordWrap: () => void
  fontSize: number
  onFontSizeChange: (size: number) => void
  fullscreen: boolean
  onToggleFullscreen: () => void
  onSaveNow: () => void
  /** Opens the floating find dialog. */
  onOpenFind: () => void
  /** Opens the floating find/replace dialog. */
  onOpenReplace: () => void
}

/**
 * The rendered preview: the same controls as a subfile, with nothing to act on.
 *
 * It declares the **whole** set rather than a reduced one. The toolbar is one
 * toolbar: if the preview carried five controls and a subfile carried twenty, the
 * bar would change shape when you switched view, and that shape-change is what
 * "unified" is supposed to mean against. So the editor-only commands are
 * declared and reported unavailable, which renders them greyed with a reason —
 * present on every view, in the same place, never a live-looking dead button.
 */
export interface SourcePreviewActions extends SourceNavigationActions {
  hasEditor: false
}

export type SourceToolbarActions = SourceEditingActions | SourcePreviewActions

/** The font-size bounds and step, the old bar's own figures. */
const FONT_MIN = 10
const FONT_MAX = 24
const FONT_STEP = 1
/** The size "reset font size" returns to. */
const FONT_DEFAULT = 14

/**
 * A declared command with nothing to run.
 *
 * Pairs with an `unavailable` state entry, which is what the shell renders as a
 * greyed control with a reason — and the shell gives an unavailable control no
 * click handler, so this is never reached by a press. It exists so the command
 * key can be present in the record without the control being dropped.
 */
const noEditor = (): void => {}

/**
 * Builds the capability record for one view of the HTML page.
 *
 * A plain function rather than a hook, because unlike the Rich Note there is no
 * reactive editor state to subscribe to: every one of these values is already held
 * by the owner as React state, and the toolbar re-renders because the owner does.
 * Inventing a subscription here would be a second source of truth.
 */
export function createSourceCapabilities(actions: SourceToolbarActions): EditorCapabilities {
  /*
   * The field switch, one capability per destination.
   *
   * Declared as four rather than one control with a panel because exactly one is
   * active at a time and each is a place to go — the toolbar's pressed state is
   * exactly that, and a panel would hide four choices behind a fifth control.
   *
   * On every view, preview included. These are how you leave the preview and get
   * to the code, so a preview that does not carry them is a dead end: the only
   * route to the HTML, CSS and JavaScript would be the page tree.
   */
  const navigation: Partial<Record<Capability, () => void>> = {
    'html.fieldPreview': (): void => actions.onFieldChange('preview'),
    'html.fieldHtml': (): void => actions.onFieldChange('html'),
    'html.fieldCss': (): void => actions.onFieldChange('css'),
    'html.fieldJs': (): void => actions.onFieldChange('javascript')
  }

  /*
   * "Where you are", on every view.
   *
   * A radio group expressed as four togges: the toolbar's `aria-pressed` carries the
   * same "you are here" that the old `SegmentedControl` carried with its filled
   * segment, and it reads correctly whether or not the two can be seen at once.
   */
  const navigationState = (): Partial<Record<Capability, CapabilityState>> => ({
    'html.fieldPreview': { active: actions.field === 'preview' },
    'html.fieldHtml': { active: actions.field === 'html' },
    'html.fieldCss': { active: actions.field === 'css' },
    'html.fieldJs': { active: actions.field === 'javascript' }
  })

  /** Runs a CodeMirror command against the live view, if there is one. */
  const withView = (action: (view: EditorView) => void) => (): void => {
    const view = actions.hasEditor ? actions.getView() : null
    if (view) action(view)
  }

  /*
   * The full command set, declared on every view.
   *
   * `withView` is a no-op with no view, so on the preview these commands exist
   * but do nothing. That is deliberate only because `state()` below refuses them:
   * a control is greyed and says why, and the shell strips a control with no
   * click handler, so it cannot be pressed into doing nothing quietly.
   */
  const commands: Partial<Record<Capability, () => void>> = {
    ...navigation,

    // Reused from the shared model: undo and redo are undo and redo everywhere.
    'history.undo': withView((view) => undo(view)),
    'history.redo': withView((view) => redo(view)),

    'ide.find': actions.hasEditor ? actions.onOpenFind : noEditor,
    'ide.replace': actions.hasEditor ? actions.onOpenReplace : noEditor,
    'ide.comment': withView((view) => toggleComment(view)),
    'ide.indent': withView((view) => indentMore(view)),
    'ide.outdent': withView((view) => indentLess(view)),
    'ide.format': actions.hasEditor ? actions.onFormat : noEditor,
    'ide.wordWrap': actions.hasEditor ? actions.onToggleWordWrap : noEditor,
    'ide.foldAll': withView((view) => foldAll(view)),
    'ide.unfoldAll': withView((view) => unfoldAll(view)),
    'ide.fontSmaller': actions.hasEditor
      ? (): void => actions.onFontSizeChange(Math.max(FONT_MIN, actions.fontSize - FONT_STEP))
      : noEditor,
    'ide.fontReset': actions.hasEditor
      ? (): void => actions.onFontSizeChange(FONT_DEFAULT)
      : noEditor,
    'ide.fontLarger': actions.hasEditor
      ? (): void => actions.onFontSizeChange(Math.min(FONT_MAX, actions.fontSize + FONT_STEP))
      : noEditor,
    'ide.saveNow': actions.hasEditor ? actions.onSaveNow : noEditor,
    'ide.fullscreen': actions.hasEditor ? actions.onToggleFullscreen : noEditor,

    /*
     * Refresh belongs to the preview alone.
     *
     * On a subfile you are not looking at the preview, and switching to it
     * rebuilds, so a refresh control there would be a second way of doing the
     * same thing. Declared only where it is the only way.
     */
    ...(actions.hasEditor ? {} : { 'html.refreshPreview': actions.onRefreshPreview })
  }

  /*
   * Every control that needs a mounted editor, for the preview's greyed report.
   *
   * Listed rather than derived, because "deriving" it means reading the command
   * set back and guessing which entries were the no-op placeholders — which is
   * exactly the kind of inference that silently rots when a control is added.
   * Adding a control here is the price of it being honest on the preview, and
   * the model-invariant test cannot catch it, so the reason is stated once.
   */
  const EDITOR_ONLY: readonly Capability[] = [
    'history.undo',
    'history.redo',
    'ide.find',
    'ide.replace',
    'ide.comment',
    'ide.indent',
    'ide.outdent',
    'ide.format',
    'ide.wordWrap',
    'ide.foldAll',
    'ide.unfoldAll',
    'ide.fontSmaller',
    'ide.fontReset',
    'ide.fontLarger',
    'ide.saveNow',
    'ide.fullscreen'
  ]

  /**
   * Live state.
   *
   * On the preview every editor control reports one reason and no more — it has
   * nothing to act on, and saying which file to open is the whole answer.
   *
   * On a subfile three things are genuinely dynamic: the history depth, the
   * font-size bounds, and the two toggles' pressed state. Everything else is
   * available by construction — there is no caret position to check, because a
   * source editor's commands all act on whatever is selected and say so if
   * nothing is.
   */
  const state = (): Partial<Record<Capability, CapabilityState>> => {
    const live: Partial<Record<Capability, CapabilityState>> = navigationState()

    if (!actions.hasEditor) {
      for (const capability of EDITOR_ONLY) {
        live[capability] = { available: unavailable(UI_TEXT.ideNeedsSourceFileReason) }
      }
      return live
    }

    const view = actions.getView()

    if (view) {
      live['history.undo'] = {
        available: undoDepth(view.state) > 0 ? AVAILABLE : unavailable('nothing to undo')
      }
      live['history.redo'] = {
        available: redoDepth(view.state) > 0 ? AVAILABLE : unavailable('nothing to redo')
      }
    } else {
      // Before the editor mounts there is nothing to act on. Said rather than left
      // silent, so the control explains itself instead of looking merely inactive.
      live['history.undo'] = { available: unavailable('the editor is still loading') }
      live['history.redo'] = { available: unavailable('the editor is still loading') }
    }

    live['ide.fontSmaller'] = {
      available:
        actions.fontSize <= FONT_MIN
          ? unavailable(`already at the smallest size (${FONT_MIN})`)
          : AVAILABLE
    }
    live['ide.fontLarger'] = {
      available:
        actions.fontSize >= FONT_MAX
          ? unavailable(`already at the largest size (${FONT_MAX})`)
          : AVAILABLE
    }

    live['ide.wordWrap'] = { active: actions.wordWrap }

    live['ide.fullscreen'] = {
      active: actions.fullscreen,
      // The name of the action, not the state, which is what a toggle button's
      // accessible name should say. The old bar swapped between these two strings
      // and the model could not, hence `CapabilityState.label`.
      label: actions.fullscreen
        ? UI_TEXT.workspaceExitFullscreenLabel
        : UI_TEXT.workspaceFullscreenLabel
    }

    return live
  }

  return { commands, state }
}
