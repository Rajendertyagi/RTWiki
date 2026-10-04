import { type EditorStateSnapshot, useEditorState } from '@blocknote/react'
import { Button, Stack, TextInput } from '@mantine/core'
import { useCallback, useMemo, useState } from 'react'

import { UI_TEXT } from '../../config/index.js'
import { RTWIKI_SCROLL } from '../../theme/registry.js'
import {
  AVAILABLE,
  type Availability,
  type Capability,
  type CapabilityState,
  type EditorCapabilities,
  type EditorMenu,
  unavailable
} from '../workspace/capabilities.js'
import { type ColorPreset, SwatchPanel } from '../workspace/swatch-panel.js'
import { DiagramTemplateMenu } from './blocks/diagram-template-menu.js'
import richClasses from './rich-editor.module.css'
import type { AnyRichEditor } from './schema.js'
import { insertWikiLink, type LinkablePage, WikiLinkPanel } from './wiki-link.js'

/**
 * The BlockNote command adapter.
 *
 * ## What this is, and what it is not
 *
 * It maps a Rich Note's capabilities onto commands, live state and panels. It
 * renders **no toolbar** — no `ActionIcon`, no `Tooltip`, no `role="toolbar"`, no
 * divider, no overflow. Every one of those belongs to `DocumentToolbar`, which is
 * the only component in the application that draws a toolbar.
 *
 * The old `rich-toolbar.tsx` was both an adapter and a toolbar, which is why it
 * was ~879 lines: the command mapping is maybe 200 of them and the chrome is the
 * rest. Splitting those is what lets two editors share one bar.
 *
 * ## State comes from the editor, never from React
 *
 * `useEditorState` is the single source of truth for what is active and what can
 * act, read through the official BlockNote hook. Nothing here mirrors editor
 * state into component state, because a mirror goes stale the moment the caret
 * moves and is the reason a toolbar that "re-renders on every keystroke" is
 * usually a copy of state rather than a reader of it.
 *
 * The one piece of React state this module holds is the link URL being typed. That
 * is genuinely not editor state — it is a form field that has no meaning until it
 * is submitted — and it is the same `linkUrl` the old toolbar held.
 */

/** The editor alias, matching the old toolbar's so the migration reads as a move. */
type AnyEditor = AnyRichEditor

/**
 * The live snapshot taken from BlockNote.
 *
 * Mirrors what the old toolbar's `useEditorState` selector returned, so the
 * pressed and available answers are computed from the same facts as before rather
 * than from a re-derivation that could disagree.
 */
interface RichState {
  readonly activeStyles: Record<string, string | boolean>
  readonly blockType: string
  readonly headingLevel: number
  readonly textAlignment: string | undefined
  readonly canNest: boolean
  readonly canUnnest: boolean
  /** The colour names the swatch panel marks as checked, if any. */
  readonly textColor: string | undefined
  readonly backgroundColor: string | undefined
  /** BlockNote reports link presence separately from the mark styles. */
  readonly hasLink: boolean
}

/** The snapshot used before the editor is ready or the caret is nowhere. */
const EMPTY_STATE: RichState = {
  activeStyles: {},
  blockType: 'paragraph',
  headingLevel: 0,
  textAlignment: undefined,
  canNest: false,
  canUnnest: false,
  textColor: undefined,
  backgroundColor: undefined,
  hasLink: false
}

/** Styles `format.clear` removes, as one call. The list is the old toolbar's. */
const CLEARED_STYLES = {
  bold: true,
  italic: true,
  underline: true,
  strike: true,
  code: true,
  textColor: 'default',
  backgroundColor: 'default'
} as const

/**
 * One insert command, bound to a registry key.
 *
 * The keys differ from the capability names — `insert.calloutInfo` is the entry
 * `insert-callout-info` — and that difference is exactly where a capability went
 * missing. Each command used to spell out its own `entriesByKey.get(...)` inline,
 * and an omission in one of them failed silently: the shell drops a capability with
 * neither a command nor a stated unavailability, so the control simply did not
 * appear. Measured: five declared callout controls rendered nowhere, with no error.
 *
 * So the mapping is written once, here, where a reader can see both names side by
 * side, and every command is `insertCommand(entriesByKey, runInsertEntry, key)`.
 */
function insertCommand(
  entries: ReadonlyMap<string, InsertEntryLike>,
  run: (entry: InsertEntryLike) => void,
  key: string
): () => void {
  return () => {
    const entry = entries.get(key)
    if (entry) run(entry)
  }
}

/**
 * The selector, hoisted to module scope.
 *
 * ## Why it is not an inline arrow
 *
 * `useEditorState` subscribes to editor transactions, re-runs the selector, and
 * re-renders only when `equalityFn` says the result *changed*. The default
 * `equalityFn` is a deep comparison, so a new-but-equal result correctly does not
 * re-render.
 *
 * That makes the selector's identity load-bearing in a way it does not look. An
 * inline arrow is a new function on every render, so the hook's internal
 * subscription was torn down and rebuilt each pass, and the snapshot it settled on
 * was the one from before the transaction. The symptom was total and quiet: bold
 * painted a `<strong>` in the document, and every pressed indicator in the toolbar
 * stayed `false` permanently. Nothing threw, and the Markdown tests passed,
 * because that adapter reads a live CodeMirror view and is unaffected.
 *
 * The old toolbar got this right by having no adapter layer at all — it called
 * the hook in the same component that rendered the buttons, so the button state
 * was the hook's state. Splitting the two made the identity matter, and it is now
 * stated here rather than left to be rediscovered.
 */
function selectRichState({ editor: ed }: EditorStateSnapshot<AnyEditor>): RichState | null {
  let block: ReturnType<typeof ed.getTextCursorPosition>['block'] | undefined
  try {
    block = ed.getTextCursorPosition().block
  } catch {
    // `getTextCursorPosition` throws when there is no block under the caret: an
    // empty document, or a selection that includes one. The fallback is kept
    // rather than "improved" — a neutral snapshot renders every control as
    // inactive, which is true, where a guess would render one as active when it is
    // not.
    return null
  }
  if (!block) return null
  const styles = ed.getActiveStyles() as Record<string, string | boolean>
  return {
    activeStyles: styles,
    blockType: block.type,
    headingLevel:
      block.type === 'heading' && typeof (block.props as { level?: number }).level === 'number'
        ? ((block.props as { level: number }).level as number)
        : 0,
    textAlignment:
      'textAlignment' in block.props
        ? (block.props.textAlignment as string | undefined)
        : undefined,
    canNest: ed.canNestBlock(),
    canUnnest: ed.canUnnestBlock(),
    textColor: typeof styles.textColor === 'string' ? styles.textColor : undefined,
    backgroundColor:
      typeof styles.backgroundColor === 'string' ? styles.backgroundColor : undefined,
    // `link` is a style in BlockNote's model, so it is read the same way as bold
    // and italic rather than through a separate API that might not exist.
    hasLink: Boolean(styles.link)
  }
}

/** Reads the live snapshot from BlockNote. */
function useRichState(editor: AnyEditor): RichState {
  const snapshot = useEditorState({ editor, selector: selectRichState })
  return snapshot ?? EMPTY_STATE
}

export interface RichCapabilitiesOptions {
  editor: AnyEditor
  /** Pages offered by the linked-page control; empty hides it. */
  linkablePages: readonly LinkablePage[]
  /**
   * Runs an insert entry from the shared registry, and reports the entries
   * themselves.
   *
   * Passed in rather than imported so this module does not reach into
   * `insert-blocks.ts` directly: the registry already depends on BlockNote, and
   * taking the two from the caller keeps the adapter's dependencies to the editor
   * and the capability contract.
   */
  insertEntries: readonly InsertEntryLike[]
  runInsertEntry: (entry: InsertEntryLike) => void
  /**
   * Inserts a diagram block holding the given Mermaid source.
   *
   * Separate from `runInsertEntry` because the diagram capability is a *chooser*, not
   * a single insert: the registry's diagram entry has no `insert`, only
   * `insertSource(editor, content)`. Constructing a fake entry inside the adapter to
   * get at that would be inventing a shape the registry does not have, so the bridge
   * binds the entry's own `insertSource` and hands it over.
   */
  insertDiagramSource: (source: string) => void
  /** Hides the linked-page control when there is nothing to link to. */
  hasLinkTarget: boolean
}

/** The subset of an insert entry this adapter needs. */
export interface InsertEntryLike {
  readonly key: string
  readonly label: string
  readonly run: string
}

/**
 * Builds the capability record for a Rich Note.
 *
 * A hook rather than a plain function, because the panels it builds close over
 * state — the link URL being typed — and a plain function cannot own that without
 * the caller re-creating every panel on every keystroke.
 */
export function useRichCapabilities(options: RichCapabilitiesOptions): EditorCapabilities {
  const {
    editor,
    linkablePages,
    insertEntries,
    runInsertEntry,
    insertDiagramSource,
    hasLinkTarget
  } = options
  const state = useRichState(editor)

  // The link URL being typed. Genuinely local: it has no editor meaning until it
  // is submitted, and BlockNote does not model an in-progress URL.
  const [linkUrl, setLinkUrl] = useState('')

  /** Runs an action and returns focus to the editor, as the old toolbar did. */
  const withEditor = useCallback(
    (action: () => void) => (): void => {
      action()
      editor.focus()
    },
    [editor]
  )

  const styleActive = useCallback(
    (name: string): boolean => Boolean(state.activeStyles[name]),
    [state.activeStyles]
  )

  const toggleStyle = useCallback(
    (name: string) => () => {
      editor.toggleStyles({ [name]: !styleActive(name) } as never)
      editor.focus()
    },
    [editor, styleActive]
  )

  const setBlock = useCallback(
    (type: string, props?: Record<string, unknown>) => (): void => {
      const block = editor.getTextCursorPosition().block
      editor.updateBlock(block, { type, props } as never)
      editor.focus()
    },
    [editor]
  )

  const applyAlignment = useCallback(
    (alignment: string) => (): void => {
      const selected = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]
      for (const block of selected) {
        if ('textAlignment' in block.props) {
          editor.updateBlock(block, { props: { textAlignment: alignment } } as never)
        }
      }
      editor.focus()
    },
    [editor]
  )

  const applyColor = useCallback(
    (highlight: boolean) => (color: ColorPreset) => (): void => {
      if (highlight) {
        if (color === 'default') editor.removeStyles({ backgroundColor: 'default' })
        else editor.addStyles({ backgroundColor: color })
      } else if (color === 'default') {
        editor.removeStyles({ textColor: 'default' })
      } else {
        editor.addStyles({ textColor: color })
      }
      editor.focus()
    },
    [editor]
  )

  const applyLink = useCallback((): void => {
    const url = linkUrl.trim()
    if (!url) return
    editor.createLink(url)
    setLinkUrl('')
    editor.focus()
  }, [editor, linkUrl])

  const commands = useMemo(() => {
    const entriesByKey = new Map(insertEntries.map((entry) => [entry.key, entry]))

    return {
      'history.undo': withEditor(() => editor.undo()),
      'history.redo': withEditor(() => editor.redo()),

      'block.paragraph': setBlock('paragraph'),
      'block.heading1': setBlock('heading', { level: 1 }),
      'block.heading2': setBlock('heading', { level: 2 }),
      'block.heading3': setBlock('heading', { level: 3 }),

      'mark.bold': toggleStyle('bold'),
      'mark.italic': toggleStyle('italic'),
      'mark.underline': toggleStyle('underline'),
      'mark.strikethrough': toggleStyle('strike'),

      'list.bullet': setBlock('bulletListItem'),
      'list.numbered': setBlock('numberedListItem'),
      'list.checklist': setBlock('checkListItem'),

      'align.left': applyAlignment('left'),
      'align.center': applyAlignment('center'),
      'align.right': applyAlignment('right'),

      'indent.outdent': withEditor(() => editor.unnestBlock()),
      'indent.increase': withEditor(() => editor.nestBlock()),

      'format.clear': withEditor(() => editor.removeStyles(CLEARED_STYLES)),

      // `insert.linkedPage` has no command here: the panel below owns it and runs
      // `insertWikiLink` directly, so a command beside it would be a second,
      // unreachable path to the same behaviour.

      /*
       * Every insert capability, each running its one registry entry.
       *
       * Declared explicitly rather than derived from the registry's keys: a
       * capability must be *decided* here, not inferred, because the registry holds
       * entries the toolbar does not expose as controls (the linked page is a panel,
       * the diagram opens a template chooser).
       *
       * All of them go through `insertCommand`, so the capability-to-entry-key
       * mapping exists once. It did not at first, and the cost was silent:
       * `entriesByKey.get('insert-callout-info')` simply was not written for the
       * five callout capabilities, so the resolver dropped all five as dead and they
       * rendered nowhere -- measured on a 1600px window, with no error.
       */
      'insert.formula': insertCommand(entriesByKey, runInsertEntry, 'insert-formula'),
      /*
       * `insert.diagram` has no command: it is a panel, and the panel owns the
       * choice. See the `menus` record below.
       *
       * It was first wired as `insertCommand(entriesByKey, ..., 'insert-diagram')`,
       * which loaded one fixed diagram on click. That is wrong: the control's whole
       * purpose is to let the user choose a template, and the old toolbar opened a
       * chooser. Measured: the click inserted a diagram and the existing
       * `diagram-templates` spec failed waiting for `insert-diagram-submenu`.
       */
      'insert.image': insertCommand(entriesByKey, runInsertEntry, 'insert-image'),
      'insert.document': insertCommand(entriesByKey, runInsertEntry, 'insert-document'),
      'insert.table': insertCommand(entriesByKey, runInsertEntry, 'insert-table'),
      'insert.codeBlock': insertCommand(entriesByKey, runInsertEntry, 'insert-code-block'),
      'insert.quote': insertCommand(entriesByKey, runInsertEntry, 'insert-quote'),
      'insert.calloutInfo': insertCommand(entriesByKey, runInsertEntry, 'insert-callout-info'),
      'insert.calloutNote': insertCommand(entriesByKey, runInsertEntry, 'insert-callout-note'),
      'insert.calloutTip': insertCommand(entriesByKey, runInsertEntry, 'insert-callout-tip'),
      'insert.calloutWarning': insertCommand(
        entriesByKey,
        runInsertEntry,
        'insert-callout-warning'
      ),
      'insert.calloutDanger': insertCommand(entriesByKey, runInsertEntry, 'insert-callout-danger')
    } as Partial<Record<Capability, () => void>>
  }, [applyAlignment, editor, insertEntries, runInsertEntry, setBlock, toggleStyle, withEditor])

  /**
   * The panels, as the same shape the Markdown and HTML adapters will use.
   *
   * The colour and highlight panels are the shared `SwatchPanel`, so the swatch
   * markup exists once for the whole application. The link panel is a plain form
   * because it is a text field and an apply button, which nothing else needs.
   */
  const menus = useMemo(() => {
    const defined: Partial<Record<Capability, EditorMenu>> = {
      /*
       * The Mermaid template chooser.
       *
       * `DiagramTemplateMenu` is the one rendering of this list. It was extracted
       * because the Diagram page and the Rich Note each had their own copy of the
       * menu markup, and `TemplateFamilyIcon` had been introduced precisely to stop
       * that drift from reaching the icons — which is the same bug one level up.
       *
       * The Rich Note's test ids are its own and are kept: `diagram-templates`
       * asserts that this chooser offers every key in `DIAGRAM_TEMPLATES` and
       * nothing else, and that assertion is the statement that one catalogue backs
       * both surfaces.
       */
      'insert.diagram': {
        content: (close) => (
          <DiagramTemplateMenu
            label={UI_TEXT.diagramLabel}
            containerTestId="insert-diagram-submenu"
            optionTestIdPrefix="insert-diagram-option"
            onPick={(source) => {
              // The insertion itself is the registry's diagram entry, told which
              // template to load. The chooser therefore needs no editor: it decides
              // the source, and `insertDiagramSource` is the registry's own
              // `insertSource` for that entry, bound to the editor by the bridge.
              insertDiagramSource(source)
              close()
            }}
          />
        )
      },
      'color.text': {
        content: (close) => (
          <SwatchPanel
            active={state.textColor ?? 'default'}
            highlight={false}
            testId="text-color-grid"
            onPick={(color) => {
              applyColor(false)(color)()
              close()
            }}
          />
        )
      },
      'color.highlight': {
        content: (close) => (
          <SwatchPanel
            active={state.backgroundColor ?? 'default'}
            highlight
            testId="highlight-grid"
            onPick={(color) => {
              applyColor(true)(color)()
              close()
            }}
          />
        )
      },
      'link.insert': {
        content: (close) => (
          <LinkPanel
            url={linkUrl}
            onUrlChange={setLinkUrl}
            onApply={() => {
              applyLink()
              close()
            }}
          />
        )
      },
      /*
       * The linked-page panel.
       *
       * `WikiLinkPanel` is the one implementation of this picker. It was extracted
       * from `WikiLinkToolbarAction`, which used to carry its own `Popover`, its
       * own target button and its own `wiki-link-button` test id — a second toolbar
       * control, which is exactly what the unified toolbar exists to remove. The
       * list semantics, the roles and the test ids are unchanged; only the trigger
       * moved to the shell.
       *
       * The presentation classes are passed in rather than imported, so this module
       * does not depend on a stylesheet for a feature it does not own.
       */
      'insert.linkedPage': {
        content: (close) => (
          <WikiLinkPanel
            pages={[...linkablePages]}
            pickerClassName={`${richClasses.wikiLinkPicker} ${RTWIKI_SCROLL}`}
            emptyClassName={richClasses.wikiLinkEmpty}
            itemClassName={richClasses.wikiLinkItem}
            itemActiveClassName={richClasses.wikiLinkItemActive}
            testId="wiki-link-picker"
            onPick={(page) => {
              insertWikiLink(editor, page)
              editor.focus()
              close()
            }}
          />
        )
      }
    }
    return defined
  }, [
    applyColor,
    applyLink,
    editor,
    // The diagram chooser calls it, so a change here has to rebuild the panel.
    insertDiagramSource,
    linkablePages,
    linkUrl,
    state.backgroundColor,
    state.textColor
  ])

  /**
   * The live state, one record read per render.
   *
   * Returned as a whole rather than read per control: the toolbar performs one
   * read, and a per-control read would be 35 reads of the same snapshot.
   */
  const liveState = useCallback((): Partial<Record<Capability, CapabilityState>> => {
    const isHeading = state.blockType === 'heading'
    const headingLevel = state.headingLevel

    /** Nesting is genuinely per-selection, so it reports a reason rather than a lie. */
    const nestingAvailability = (can: boolean, what: string): Availability =>
      can ? AVAILABLE : unavailable(`nothing to ${what} here`)

    return {
      'history.undo': { available: AVAILABLE },
      'history.redo': { available: AVAILABLE },

      'block.paragraph': { active: state.blockType === 'paragraph' },
      'block.heading1': { active: isHeading && headingLevel === 1 },
      'block.heading2': { active: isHeading && headingLevel === 2 },
      'block.heading3': { active: isHeading && headingLevel === 3 },

      'mark.bold': { active: styleActive('bold') },
      'mark.italic': { active: styleActive('italic') },
      'mark.underline': { active: styleActive('underline') },
      'mark.strikethrough': { active: styleActive('strike') },

      'color.text': { active: Boolean(state.textColor && state.textColor !== 'default') },
      'color.highlight': {
        active: Boolean(state.backgroundColor && state.backgroundColor !== 'default')
      },

      'link.insert': { active: state.hasLink },

      'list.bullet': { active: state.blockType === 'bulletListItem' },
      'list.numbered': { active: state.blockType === 'numberedListItem' },
      'list.checklist': { active: state.blockType === 'checkListItem' },

      'align.left': { active: state.textAlignment === 'left' },
      'align.center': { active: state.textAlignment === 'center' },
      'align.right': { active: state.textAlignment === 'right' },

      'indent.outdent': { available: nestingAvailability(state.canUnnest, 'outdent') },
      'indent.increase': { available: nestingAvailability(state.canNest, 'indent') },

      'insert.linkedPage': hasLinkTarget
        ? { available: AVAILABLE }
        : { available: unavailable('no other page to link to') }
    }
  }, [hasLinkTarget, state, styleActive])

  return useMemo(() => ({ commands, menus, state: liveState }), [commands, liveState, menus])
}

/**
 * The linked-page panel: a filter field over the pages in the workspace.
 *
 * Its filtering is `filterLinkablePages` and its insert is `insertWikiLink`, both
 * from the existing module, so this is a shell around the one implementation
 * rather than a second implementation of "link to a page here".
 */
/**
 * The link panel: a URL field and an apply action.
 *
 * Split out because it is the one panel that is not a swatch grid, and because a
 * form inside a popover needs its own submit handling — Enter in the field
 * applies, which is what the old toolbar's `onKeyDown` did.
 */
/**
 * The link panel: a URL field and an apply action.
 *
 * A `Stack` rendered as the form, rather than a bare `<form>` with inline layout.
 * `tests/theme-registry.test.ts` fails a build where a component file carries
 * inline `display` or `gap`, and that gate caught the hand-written version of this
 * panel. `Stack` is also what the rest of the application uses for a vertical run,
 * so the spacing comes from the theme rather than from a token restated here.
 *
 * It is a real form because Enter in the field must apply, which the old toolbar
 * implemented with a `keydown` handler and a form gets for free.
 */
function LinkPanel({
  url,
  onUrlChange,
  onApply
}: {
  url: string
  onUrlChange: (value: string) => void
  onApply: () => void
}): React.ReactElement {
  return (
    <Stack
      component="form"
      gap="xs"
      aria-label={UI_TEXT.linkLabel}
      onSubmit={(event) => {
        event.preventDefault()
        onApply()
      }}
    >
      <TextInput
        placeholder="https://example.com"
        label={UI_TEXT.linkLabel}
        value={url}
        data-testid="link-url-input"
        onChange={(event) => onUrlChange(event.currentTarget.value)}
      />
      <Button size="compact-xs" type="submit" data-testid="link-apply">
        {UI_TEXT.linkApply}
      </Button>
    </Stack>
  )
}
