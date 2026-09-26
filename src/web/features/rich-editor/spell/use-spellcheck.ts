import type { EditorView } from 'prosemirror-view'
import { useEffect } from 'react'
import { loadNspellEngine } from './nspell-adapter.js'
import { loadSpellChecker, resetSpellCheckerCache } from './spell-checker.js'
import { installSpellcheck, removeSpellcheck } from './spellcheck-plugin.js'

/**
 * The part of BlockNote's editor this hook needs.
 *
 * Typing the parameter as `BlockNoteEditor<...>` would drag in three generic
 * schema parameters this hook has no use for, and the wildcard forms of those
 * generics do not satisfy BlockNote's own constraints. A structural type states
 * precisely what is required, and the real editor satisfies it unchanged.
 */
interface SpellcheckTarget {
  readonly prosemirrorView: EditorView | null
  /**
   * BlockNote's post-mount hook. Optional so a bare view holder still works, and
   * because it is genuinely optional: the view may already exist.
   */
  onMount?: (callback: () => void) => () => void
}

/**
 * Keeps the spell-check plugin in step with the editor and the user's settings.
 *
 * Two facts about the lifecycle drive the shape of this:
 *
 * 1. The ProseMirror view does not exist until the editor mounts, so installing
 *    from an effect alone can run against a view that is not there yet. Hence
 *    `onMount`, which BlockNote documents for exactly this ("useful for plugins
 *    to initialize themselves after the editor has been mounted"). The immediate
 *    attempt covers the case where the editor is already mounted.
 *
 * 2. The dictionary is fetched asynchronously, so there is a window where the
 *    editor is live and the underlines are not yet there. Rather than blocking
 *    the editor on a 552 kB fetch, the plugin is installed when the load
 *    resolves and the view is nudged to redraw - otherwise the underlines would
 *    not appear until the reader's next keystroke, which reads as "it did
 *    nothing".
 */
export function useSpellcheck(
  editor: SpellcheckTarget | null,
  enabled: boolean,
  personalWords: readonly string[]
): void {
  // The personal list is part of the load, so it is a dependency by value. A
  // stable string key avoids re-running on every render, when the array is a
  // fresh literal each time.
  const wordsKey = personalWords.join('\n')

  useEffect(() => {
    if (!enabled || !editor) return
    let cancelled = false

    const words = wordsKey.length > 0 ? wordsKey.split('\n') : []
    // A changed personal list must be re-taught from scratch: the engine keeps
    // what it has learned and offers no way to unlearn a word.
    if (wordsKey.length > 0) resetSpellCheckerCache()

    const attach = (): void => {
      if (cancelled) return
      void loadSpellChecker(words, loadNspellEngine).then((checker) => {
        if (cancelled || !checker) return
        // Re-read the view: the load is async and the editor may have been
        // replaced or unmounted while the dictionary was in flight.
        const view = editor.prosemirrorView
        if (!view || !view.dom.isConnected) return
        installSpellcheck(view, checker)
        // Force the view to re-read its state so decorations are recomputed.
        //
        // Dispatching an empty transaction does not work: BlockNote installs its
        // own `dispatchTransaction`, which is free to ignore a transaction with
        // no steps, and it does. `updateState` is the documented way to make a
        // view re-read the state it already holds, and it cannot be filtered
        // because it is not a transaction at all. Nothing changes and no history
        // entry is created, which a transaction would risk.
        view.updateState(view.state)
      })
    }

    const unsubscribe = editor.onMount ? editor.onMount(attach) : undefined
    attach()

    return () => {
      cancelled = true
      unsubscribe?.()
      const view = editor.prosemirrorView
      if (view && view.dom.isConnected) removeSpellcheck(view)
    }
  }, [editor, enabled, wordsKey])
}
