import { Plugin } from 'prosemirror-state'
import { DecorationSet } from 'prosemirror-view'
import type { SpellChecker } from './spell-checker.js'
import { buildMisspellingDecorations } from './spellcheck-decorations.js'

/**
 * A BlockNote extension that carries the spell-check decorations.
 *
 * ## Why an extension and not a plugin pushed onto the view
 *
 * The first attempt installed a view-level plugin after mount with
 * `view.setProps({ plugins: [...] })`. It worked - the underlines appeared - and
 * it cost the editor its caret: opening an existing Rich Note left the document
 * unfocused, and two workspace tests failed. Mutating an already-mounted
 * BlockNote view's props is disruptive, and deferring the work to idle time did
 * not help, because by then the editor was focused and the mutation dropped it.
 *
 * BlockNote already has the supported mechanism, and its own extensions use it
 * for exactly this purpose: `Extension.prosemirrorPlugins` is how `YCursorPlugin`
 * and `TrailingNode` contribute `DecorationSet`s. A plugin supplied this way is
 * part of the editor state from the start, so nothing is mutated after mount and
 * focus is never at risk. `BlockNoteEditorOptions.extensions` is additive - the
 * installed build does `for (let e of this.options.extensions ?? []) this.addExtension(e)`
 * - so BlockNote's own extensions are kept.
 *
 * ## Why the checker arrives late
 *
 * The dictionary is 552 kB and must not be fetched before it is needed, so the
 * plugin is built immediately against a holder that starts empty and is filled
 * when the load resolves. Until then the plugin decorates nothing, which is why
 * there is no error and no flash: the underlines simply appear once ready.
 */

/** Shared between the extension and the hook that loads the dictionary. */
export interface SpellcheckHolder {
  checker: SpellChecker | null
}

export function createSpellcheckHolder(): SpellcheckHolder {
  return { checker: null }
}

/** The plugin's identity is part of the editor state, so it must be stable. */
export const SPELLCHECK_EXTENSION_KEY = 'rtwikiSpellcheck'

/**
 * Builds the extension factory for `holder`.
 *
 * Returns the *factory* rather than the extension, because that is what
 * `BlockNoteEditorOptions.extensions` takes - BlockNote's own extensions are
 * declared the same way (`TrailingNodeExtension` is
 * `(options?) => ExtensionFactoryInstance<...>`).
 *
 * Call once per editor and keep the returned function: it is captured in the
 * editor options, and a fresh identity each render would be a new extension.
 */
export function createSpellcheckExtensionFactory(holder: SpellcheckHolder) {
  const plugin = new Plugin({
    props: {
      decorations: (state) =>
        holder.checker ? buildMisspellingDecorations(state, holder.checker) : DecorationSet.empty
    }
  })

  return () => ({
    key: SPELLCHECK_EXTENSION_KEY,
    prosemirrorPlugins: [plugin]
  })
}
