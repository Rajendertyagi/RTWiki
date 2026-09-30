import type { EditorView } from 'prosemirror-view'
import { useEffect } from 'react'
import { loadNspellEngine } from './nspell-adapter.js'
import { loadSpellChecker, resetSpellCheckerCache } from './spell-checker.js'
import { refreshSpellcheckDecorations } from './spellcheck-decorations.js'
import type { SpellcheckHolder } from './spellcheck-extension.js'

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
}

/** Ceiling on how long the load may be deferred waiting for idle time. */
const IDLE_FALLBACK_MS = 2000

/**
 * Runs `task` when the browser is idle, or after the fallback, whichever is
 * first.
 *
 * `requestIdleCallback` is Chromium-only and absent in some embedded webviews, so
 * the timeout path is not optional: without it a browser lacking the API would
 * never load the dictionary and the feature would silently do nothing. The
 * timeout also bounds how long the underlines can be delayed on a busy thread.
 */
function runWhenIdle(task: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => task(), { timeout: IDLE_FALLBACK_MS })
    return
  }
  setTimeout(task, 200)
}

/**
 * Loads the dictionary and hands it to the extension's holder.
 *
 * The hook owns the loading; the extension owns the decorations. Nothing here
 * mutates the editor's view props, which is what cost the caret in the first
 * attempt - see the note in `spellcheck-extension.ts`.
 *
 * The whole job waits for idle time. Measured, not assumed: the engine is built
 * from a 552 kB dictionary and that build blocks the main thread, so doing it
 * during startup starved the editor's own post-mount focus work and left the
 * document unfocused when an existing note was opened.
 */
export function useSpellcheck(
  editor: SpellcheckTarget | null,
  holder: SpellcheckHolder,
  enabled: boolean,
  personalWords: readonly string[]
): void {
  // The personal list is part of the load, so it is a dependency by value. A
  // stable string key avoids re-running on every render, when the array is a
  // fresh literal each time.
  const wordsKey = personalWords.join('\n')

  useEffect(() => {
    // Switching the feature off must also take the underlines away, not merely
    // stop loading: the plugin is already in the editor state for the life of the
    // page, so the holder is emptied instead.
    if (!enabled) {
      holder.checker = null
      return
    }
    if (!editor) return
    let cancelled = false

    const words = wordsKey.length > 0 ? wordsKey.split('\n') : []
    // A changed personal list must be re-taught from scratch: the engine keeps
    // what it has learned and offers no way to unlearn a word.
    if (wordsKey.length > 0) resetSpellCheckerCache()

    runWhenIdle(() => {
      if (cancelled) return
      void loadSpellChecker(words, loadNspellEngine).then((checker) => {
        if (cancelled || !checker) return
        holder.checker = checker
        // The plugin reads the holder on every decoration pass, so a metadata-only
        // transaction is all it takes to make the underlines appear.
        const view = editor.prosemirrorView
        if (view?.dom.isConnected) refreshSpellcheckDecorations(view)
      })
    })

    return () => {
      cancelled = true
    }
  }, [editor, holder, enabled, wordsKey])
}
