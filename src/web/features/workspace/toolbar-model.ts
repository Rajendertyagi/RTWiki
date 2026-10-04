import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowsDiagonal,
  IconBold,
  IconBraces,
  IconBulb,
  IconChevronDown,
  IconChevronUp,
  IconClearFormatting,
  IconCode,
  IconDeviceFloppy,
  IconDots,
  IconEye,
  IconFileText,
  IconFoldDown,
  IconFoldUp,
  IconH1,
  IconH2,
  IconH3,
  IconHighlight,
  IconHtml,
  IconInfoCircle,
  IconItalic,
  IconLetterA,
  IconLetterF,
  IconLink,
  IconList,
  IconListCheck,
  IconListNumbers,
  IconNote,
  IconPalette,
  IconPhoto,
  IconPilcrow,
  IconQuote,
  IconRefresh,
  IconReplace,
  IconSearch,
  IconSitemap,
  IconSortAscending,
  IconSortDescending,
  IconStrikethrough,
  IconTable,
  IconTextWrap,
  IconUnderline,
  IconZoomIn,
  IconZoomOut,
  IconZoomReset
} from '@tabler/icons-react'
import type { ComponentType } from 'react'

import { UI_TEXT } from '../../config/index.js'
import type { Capability } from './capabilities.js'

/**
 * The single description of the toolbar: which controls exist, in what order,
 * how they are grouped, and what each one is called.
 *
 * ## Why the whole toolbar is one list
 *
 * The control set was previously implied by whichever component rendered the
 * row, so a Rich Note and a Markdown Note had different controls because they
 * had different components. That is the drift this file exists to remove: the
 * set is declared once, here, and both surfaces render it.
 *
 * Ordering and grouping are data for the same reason. A group boundary is a
 * `<Divider>`, and where the boundaries fall is a design decision, not
 * something a component should re-derive from a list of strings.
 */

/** The icon size every control on this bar uses, matching the existing toolbar. */
const ICON_SIZE = 16

export interface ToolbarControl {
  /**
   * Stable machine identity.
   *
   * Never an array index and never the label. The key is what React reconciles
   * against, so a positional key tears a control down and rebuilds it whenever
   * anything above it changes — which is how the previous attempt produced a
   * toolbar that visibly re-laid-out on every caret move. The capability name
   * is used as the key because it is already unique and already stable.
   */
  readonly key: Capability
  /** The accessible name. One source: the central UI text dictionary. */
  readonly label: string
  readonly Icon: ComponentType<{ size?: number }>
  /**
   * A stable test id, applied as `data-testid` on the rendered control.
   *
   * Declared here rather than derived from the capability name, because the
   * existing browser suite addresses controls by ids that predate this model —
   * `toolbar-more`, `clear-formatting`, `wiki-link-button` — and those ids are part
   * of the project's test surface. Deriving them mechanically would have silently
   * renamed every one of them.
   *
   * Absent means the control is addressed by its accessible name instead, which is
   * what a screen-reader-driven test would do anyway and is the better default for
   * a control with a unique label.
   */
  readonly testId?: string
}

/** One run of related controls. Runs become groups, separated by a divider. */
export interface ToolbarGroup {
  /** Identity for the divider that precedes this group. Never positional. */
  readonly key: string
  readonly controls: readonly ToolbarControl[]
  /**
   * Which end of the bar this group belongs to. `start` is the default.
   *
   * `end` pins the group to the right edge, whatever the window width and whatever
   * else is in the row. It exists for the HTML page's Preview / HTML / CSS / JS switch,
   * which used to sit *beside* the toolbar in a `justify="space-between"` group — so the
   * bar measured 683px in a 1600px row and the switch floated in the leftover space.
   *
   * Implemented with `margin-left: auto` on the group's first control, which is the one
   * flex mechanism that does it: it pushes that control and everything after it to the
   * right, adds no element to the row for the overflow hook to measure, and needs no
   * absolute positioning, transform or pixel offset.
   */
  readonly align?: 'start' | 'end'
}

const control = (
  key: Capability,
  label: string,
  Icon: ToolbarControl['Icon'],
  testId?: string
): ToolbarControl => ({ key, label, Icon, testId })

/**
 * The toolbar, as data.
 *
 * The order and the grouping are the existing Rich Note toolbar's, taken from
 * `rich-toolbar.tsx` and `INSERT_RUNS` in `insert-blocks.ts`, so adopting this
 * list does not rearrange a bar the user already knows. The three insert runs
 * keep their own dividers because `INSERT_RUNS` declares them as separate runs.
 */
export const TOOLBAR_GROUPS: readonly ToolbarGroup[] = [
  {
    key: 'history',
    controls: [
      control('history.undo', UI_TEXT.undoLabel, IconArrowBackUp),
      control('history.redo', UI_TEXT.redoLabel, IconArrowForwardUp)
    ]
  },
  {
    key: 'block',
    controls: [
      control('block.paragraph', UI_TEXT.paragraphLabel, IconPilcrow),
      control('block.heading1', `${UI_TEXT.headingLabel} 1`, IconH1),
      control('block.heading2', `${UI_TEXT.headingLabel} 2`, IconH2),
      control('block.heading3', `${UI_TEXT.headingLabel} 3`, IconH3)
    ]
  },
  {
    key: 'inline',
    controls: [
      control('mark.bold', UI_TEXT.boldLabel, IconBold),
      control('mark.italic', UI_TEXT.italicLabel, IconItalic),
      control('mark.underline', UI_TEXT.underlineLabel, IconUnderline),
      control('mark.strikethrough', UI_TEXT.strikeLabel, IconStrikethrough),
      control('color.text', UI_TEXT.textColorLabel, IconLetterA),
      control('color.highlight', UI_TEXT.highlightLabel, IconHighlight)
    ]
  },
  {
    key: 'link',
    controls: [control('link.insert', UI_TEXT.linkLabel, IconLink)]
  },
  {
    key: 'list',
    controls: [
      control('list.bullet', UI_TEXT.bulletListLabel, IconList),
      control('list.numbered', UI_TEXT.numberedListLabel, IconListNumbers),
      control('list.checklist', UI_TEXT.checklistLabel, IconListCheck)
    ]
  },
  {
    key: 'align',
    controls: [
      control('align.left', UI_TEXT.alignLeft, IconAlignLeft),
      control('align.center', UI_TEXT.alignCenter, IconAlignCenter),
      control('align.right', UI_TEXT.alignRight, IconAlignRight)
    ]
  },
  {
    key: 'indent',
    controls: [
      control('indent.outdent', UI_TEXT.outdentLabel, IconSortAscending),
      control('indent.increase', UI_TEXT.indentLabel, IconSortDescending),
      control('format.clear', UI_TEXT.clearFormattingLabel, IconClearFormatting, 'clear-formatting')
    ]
  },
  {
    // INSERT_RUNS 'blocks'
    key: 'insert-blocks',
    controls: [
      control('insert.formula', UI_TEXT.formulaLabel, IconLetterA, 'insert-formula'),
      control('insert.diagram', UI_TEXT.diagramLabel, IconSitemap, 'insert-diagram'),
      control('insert.linkedPage', UI_TEXT.linkedPageLabel, IconLink, 'wiki-link-button'),
      control('insert.image', UI_TEXT.imageLabel, IconPhoto, 'insert-image'),
      control('insert.document', UI_TEXT.documentLabel, IconFileText, 'insert-document')
    ]
  },
  {
    // INSERT_RUNS 'basic'
    key: 'insert-basic',
    controls: [
      control('insert.table', UI_TEXT.tableLabel, IconTable, 'insert-table'),
      control('insert.codeBlock', UI_TEXT.codeBlockLabel, IconCode, 'insert-code-block'),
      control('insert.quote', UI_TEXT.quoteLabel, IconQuote, 'insert-quote')
    ]
  },
  {
    // INSERT_RUNS 'callout' — five severities, one per entry.
    key: 'insert-callout',
    controls: [
      control(
        'insert.calloutInfo',
        UI_TEXT.calloutInfoLabel,
        IconInfoCircle,
        'insert-callout-info'
      ),
      control('insert.calloutNote', UI_TEXT.calloutNoteLabel, IconNote, 'insert-callout-note'),
      control('insert.calloutTip', UI_TEXT.calloutTipLabel, IconBulb, 'insert-callout-tip'),
      control(
        'insert.calloutWarning',
        UI_TEXT.calloutWarningLabel,
        IconAlertTriangle,
        'insert-callout-warning'
      ),
      control(
        'insert.calloutDanger',
        UI_TEXT.calloutDangerLabel,
        IconAlertOctagon,
        'insert-callout-danger'
      )
    ]
  },

  /*
   * The two source-editor groups.
   *
   * ## Why they exist at all
   *
   * The HTML/CSS/JavaScript subfile editor had its own toolbar with 17 controls. It
   * was not in this model because it had never been a document surface — it has no
   * blocks, no inline marks, no colours — so every control it owns is prefixed
   * `ide.` and declared here.
   *
   * ## Why two groups and not one
   *
   * The old bar drew five dividers with no meaning behind them: undo/redo, then
   * find/replace, then comment/indent/outdent, then format/wrap/fold, then
   * font-size, then save/fullscreen. A divider is a claim — "these belong together"
   * — and it was making one.
   *
   * Split by what the action acts on, which is the distinction that survives:
   *
   * - `ide-formatting` changes the text: indent, outdent, format.
   * - `ide-tools` acts on the editor rather than the document: it navigates, reveals,
   *   or changes how the source is displayed. Find, replace, comment, fold, unfold,
   *   word wrap, font size, save now, fullscreen.
   *
   * Word wrap started in `ide-formatting` and was moved. It reads like formatting — it
   * looks like "I wrapped it" — but it wraps lines in the *editor*, and nothing in the
   * document changes. Font size is the same case. Leaving both in the formatting group
   * would have put a document-changing claim on two view settings, which is the kind
   * of thing that reads as a bug later: "why did wrapping mark the document as
   * formatted?"
   *
   * The two are ordered formatting-then-IDE, and that order is the rule for every
   * surface: whatever a surface's groups are, the ones that change the document come
   * before the ones that change the editor around it.
   *
   * "Back to preview" is in neither. It is a view switch, like the Markdown page's
   * Edit/Preview control, so it is rendered in the row's `trailing` slot rather than
   * being declared as a formatting command.
   *
   * Order within each group is the old bar's order, so nothing moves that did not
   * have to.
   */
  {
    key: 'ide-formatting',
    controls: [
      control('ide.indent', UI_TEXT.ideIndentLabel, IconChevronUp, 'ide-indent'),
      control('ide.outdent', UI_TEXT.ideOutdentLabel, IconChevronDown, 'ide-outdent'),
      control('ide.format', UI_TEXT.ideFormatLabel, IconLetterF, 'ide-format')
    ]
  },
  {
    key: 'ide-tools',
    controls: [
      control('ide.find', UI_TEXT.ideFindLabel, IconSearch, 'ide-find'),
      control('ide.replace', UI_TEXT.ideReplaceLabel, IconReplace, 'ide-replace'),
      control('ide.comment', UI_TEXT.ideCommentLabel, IconCode, 'ide-comment'),
      control('ide.foldAll', UI_TEXT.ideFoldAllLabel, IconFoldDown, 'ide-fold-all'),
      control('ide.unfoldAll', UI_TEXT.ideUnfoldAllLabel, IconFoldUp, 'ide-unfold-all'),
      control('ide.wordWrap', UI_TEXT.ideWordWrapLabel, IconTextWrap, 'ide-word-wrap'),
      control('ide.fontSmaller', UI_TEXT.ideFontSmallerLabel, IconZoomOut, 'ide-font-decrease'),
      control('ide.fontReset', UI_TEXT.ideFontResetLabel, IconZoomReset, 'ide-font-reset'),
      control('ide.fontLarger', UI_TEXT.ideFontLargerLabel, IconZoomIn, 'ide-font-increase'),
      control('ide.saveNow', UI_TEXT.ideSaveNowLabel, IconDeviceFloppy, 'ide-save-now'),
      control(
        'ide.fullscreen',
        UI_TEXT.workspaceFullscreenLabel,
        IconArrowsDiagonal,
        'ide-fullscreen'
      )
    ]
  },

  /*
   * Rebuilding the preview.
   *
   * Its own group, and not a member of `html-fields`, because a divider is a
   * claim about what belongs together. Refresh acts on the preview; the field
   * buttons are navigation between four views of the page. They are not the
   * same kind of control and the group is where the model says so.
   *
   * Left-aligned, so the bar starts from the left edge of the row on every
   * surface, the way the Rich Note's and the Markdown page's do.
   */
  {
    key: 'html-preview',
    controls: [
      control('html.refreshPreview', UI_TEXT.refreshPreviewLabel, IconRefresh, 'refresh-preview')
    ]
  },

  /*
   * The HTML page's Preview / HTML / CSS / JS switch, pinned to the right edge.
   *
   * Declared as a group rather than left as a `SegmentedControl` beside the bar, which is
   * where it used to live and why it was outside the toolbar's `role="toolbar"`, its
   * roving focus and its overflow. Four toggles, one active at a time.
   *
   * `align: 'end'` because a view switch belongs at the far right of the row: it is not
   * an editing action, and pinning it means it stays put while the editing groups to its
   * left overflow as the window narrows.
   */
  {
    key: 'html-fields',
    align: 'end',
    controls: [
      control('html.fieldPreview', UI_TEXT.editorTabPreview, IconEye, 'html-field-preview'),
      control('html.fieldHtml', UI_TEXT.editorTabHtml, IconHtml, 'html-field-html'),
      control('html.fieldCss', UI_TEXT.editorTabCss, IconPalette, 'html-field-css'),
      control('html.fieldJs', UI_TEXT.editorTabJs, IconBraces, 'html-field-js')
    ]
  }
]

/** Every control, flattened, in bar order. The list the shell walks. */
export const TOOLBAR_CONTROLS: readonly ToolbarControl[] = TOOLBAR_GROUPS.flatMap(
  (group) => group.controls
)

/** The trailing overflow control. Present on every surface, like the existing bar's. */
export const OVERFLOW_CONTROL: ToolbarControl = {
  key: 'overflow' as Capability,
  label: UI_TEXT.toolbarMoreLabel,
  Icon: IconDots
}

/** The label for the whole bar, for `role="toolbar"`. */
export const TOOLBAR_LABEL = UI_TEXT.richToolbarLabel

export { ICON_SIZE }
