import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type { SpellChecker } from './spell-checker.js'

/**
 * Turns a document into spell-check decorations.
 *
 * Kept apart from the extension and the React hook so it has no dependency on
 * either, and so the rule about which text is checked is readable in one place.
 */

export const MISSPELLING_CLASS = 'rtwiki-spellcheck-misspelling'

/** Attribute carrying the flagged word, so a click can offer corrections. */
export const MISSPELLING_WORD_ATTR = 'data-spellcheck-word'

function isCodeNode(node: ProseMirrorNode): boolean {
  // `code: true` in a node spec is BlockNote/TipTap's own marker for a code
  // context, and covers code blocks and any custom code-ish block. The name check
  // is the fallback for schemas that do not set the flag.
  if (node.type.spec.code === true) return true
  return node.type.name === 'codeBlock'
}

/**
 * True when a position sits inside code, where spelling is not the reader's
 * concern: identifiers, shell commands and CSS property names are all "wrong" by
 * design, and underlining them makes the feature noise rather than help.
 */
function isInsideCode(state: EditorState, pos: number): boolean {
  try {
    return isCodeNode(state.doc.resolve(pos).parent)
  } catch {
    return false
  }
}

/**
 * Collects every misspelling in the document as inline decorations.
 *
 * Recomputed per transaction rather than mapped, because a single keystroke
 * changes which words are misspelling-adjacent and mapping cannot know that. The
 * cost is kept acceptable by the checker's per-word memo: a rescan is dictionary
 * lookups that have already been answered, not re-analysis.
 */
export function buildMisspellingDecorations(
  state: EditorState,
  checker: SpellChecker
): DecorationSet {
  const decorations: Decoration[] = []

  state.doc.descendants((node, pos) => {
    if (!node.isText) return true
    const text = node.text
    if (!text || text.length === 0) return false
    if (isInsideCode(state, pos)) return false

    // For a text node, `descendants` reports the position of its first character,
    // not the position before it. Adding one shifted every underline a character
    // to the right, so "mispeling" was underlined as "ispeling ".
    for (const finding of checker.check(text)) {
      decorations.push(
        Decoration.inline(pos + finding.from, pos + finding.to, {
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
 * Asks the editor to recompute decorations after the checker arrives.
 *
 * A metadata-only transaction, with history disabled: it changes no content and
 * must not appear in undo, and because the plugin is part of the editor state
 * this is an ordinary transaction that BlockNote processes normally. This is the
 * supported alternative to mutating the view, which cost the caret.
 */
export function refreshSpellcheckDecorations(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta('addToHistory', false).setMeta('rtwikiSpellcheck', true))
}
