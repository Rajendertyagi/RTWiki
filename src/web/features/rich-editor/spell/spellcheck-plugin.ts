import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { type EditorState, Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type { SpellChecker } from './spell-checker.js'

/**
 * Draws spell-check underlines inside a BlockNote editor.
 *
 * ## Why this is a *view-level* plugin
 *
 * BlockNote exposes no option for adding a ProseMirror plugin, and its
 * `EditorView` is created internally. `EditorView` does accept a `plugins` prop
 * for view-level plugins, and the installed ProseMirror honours them for
 * decorations specifically: `EditorView.someProp` consults `_props`, then
 * `directPlugins`, then `state.plugins`, and `viewDecorations` resolves
 * decorations through `someProp("decorations")`.
 *
 * A view-level plugin may NOT declare a state field, a `filterTransaction` or
 * an `appendTransaction`: ProseMirror throws on those for direct plugins. This
 * one declares only `decorations`, which is why that restriction costs nothing.
 * It is installed with `setProps`, merging with any plugins already there
 * rather than replacing them.
 *
 * ## Why not the browser's spell checker
 *
 * Because JavaScript cannot add words to it. Browsers treat the system
 * dictionary as private (ProseMirror/prosemirror#390), so a personal word list
 * is impossible with the native checker - which is most of the value here.
 */

export const MISSPELLING_CLASS = 'rtwiki-spellcheck-misspelling'

/** Attribute carrying the flagged word, so a click can offer corrections. */
export const MISSPELLING_WORD_ATTR = 'data-spellcheck-word'

/**
 * True when a position sits inside code, where spelling is not the reader's
 * concern: identifiers, shell commands and CSS property names are all "wrong"
 * by design and underlining them makes the feature noise rather than help.
 */
function isInsideCode(state: EditorState, pos: number): boolean {
  try {
    const parent = state.doc.resolve(pos).parent
    return isCodeNode(parent)
  } catch {
    return false
  }
}

function isCodeNode(node: ProseMirrorNode): boolean {
  // `code: true` in a node spec is BlockNote/TipTap's own marker for a code
  // context, and covers code blocks and any custom code-ish block. The name
  // check is the fallback for schemas that do not set the flag.
  if (node.type.spec.code === true) return true
  return node.type.name === 'codeBlock'
}

/**
 * Collects every misspelling in the document as inline decorations.
 *
 * Recomputed per transaction rather than mapped, because a single keystroke
 * changes which words are misspelling-adjacent and mapping cannot know that.
 * The cost is kept acceptable by the checker's per-word memo: a rescan is
 * dictionary lookups that have already been answered, not re-analysis.
 */
function buildDecorations(state: EditorState, checker: SpellChecker): DecorationSet {
  const decorations: Decoration[] = []

  state.doc.descendants((node, pos) => {
    if (!node.isText) return true
    const text = node.text
    // Empty text nodes are not worth descending into.
    if (!text || text.length === 0) return false
    if (isInsideCode(state, pos)) return false

    // For a text node, `descendants` reports the position of its first
    // character, not the position before it. Adding one shifted every underline
    // a character to the right, so "mispeling" was underlined as "ispeling ".
    const start = pos
    for (const finding of checker.check(text)) {
      decorations.push(
        Decoration.inline(start + finding.from, start + finding.to, {
          class: MISSPELLING_CLASS,
          [MISSPELLING_WORD_ATTR]: finding.word
        })
      )
    }
    return false
  })
  return DecorationSet.create(state.doc, decorations)
}

/**
 * The plugins this module created.
 *
 * `Plugin` exposes no public identity, and `installSpellcheck` has to tell "mine"
 * from "BlockNote's" to replace rather than accumulate. Tagging the instances we
 * build is exact and costs nothing; comparing decorations would mean rebuilding
 * a DecorationSet to inspect it.
 */
const OUR_PLUGINS = new WeakSet<Plugin>()

/** Builds the plugin for an already-loaded checker. */
export function createSpellcheckPlugin(checker: SpellChecker): Plugin {
  const plugin = new Plugin({
    // Nested under `props`, which is not obvious and cost real time to find: the
    // Plugin constructor copies only `spec.props` into the object
    // `EditorView.someProp` reads (`if (spec.props) bindProps(spec.props, ...)`).
    // A bare `decorations` key lands on `spec` and is never consulted, so the
    // plugin installs cleanly and silently decorates nothing.
    props: {
      // Typed explicitly: the callback's parameter is not inferred from the
      // spec, and under `noImplicitAny` that leaves it as `any`.
      decorations: (state: EditorState) => buildDecorations(state, checker)
    }
  })
  OUR_PLUGINS.add(plugin)
  return plugin
}

/** Everything except the plugins this module owns. */
function withoutSpellcheck(plugins: readonly Plugin[]): Plugin[] {
  return plugins.filter((plugin) => !OUR_PLUGINS.has(plugin))
}

/**
 * Installs (or replaces) the spell-check plugin on a live view.
 *
 * Existing direct plugins are preserved: `setProps` replaces the whole `plugins`
 * array, so passing only ours would silently disable anything BlockNote had put
 * there. Call again with a different checker after the personal dictionary
 * changes, which is far cheaper than rebuilding the view.
 */
export function installSpellcheck(view: EditorView, checker: SpellChecker): void {
  view.setProps({
    plugins: [...withoutSpellcheck(view.props.plugins ?? []), createSpellcheckPlugin(checker)]
  })
}

/** Removes the spell-check plugin, leaving other direct plugins intact. */
export function removeSpellcheck(view: EditorView): void {
  view.setProps({ plugins: withoutSpellcheck(view.props.plugins ?? []) })
}
