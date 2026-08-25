import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit
} from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { htmlEditorHighlighting, htmlEditorTheme } from './editor-theme.js'

export type CodeEditorLanguage = 'html' | 'css' | 'javascript'

export interface EditorStats {
  line: number
  column: number
  selectedChars: number
}

function languageExtension(language: CodeEditorLanguage): Extension {
  switch (language) {
    case 'html':
      // Native tag matching/closing for HTML sources.
      return html({ autoCloseTags: true })
    case 'css':
      return css()
    case 'javascript':
      return javascript()
  }
}

const BASE_FONT_SIZE = 14

export interface UseCodeMirrorOptions {
  /** Controlled document value. */
  value: string
  onChange: (value: string) => void
  language: CodeEditorLanguage
  /** Accessible name announced for the editable region. */
  ariaLabel: string
  /** Word-wrap toggle; reconfigured without remounting. */
  wordWrap: boolean
  /** Font size in px (toolbar-controlled). */
  fontSize: number
  /** Selection/caret statistics for the status row. */
  onStatsChange?: (stats: EditorStats) => void
  /** Extra key bindings; return true to mark a keystroke handled. */
  extraKeys?: Array<{ key: string; run: () => boolean }>
}

export interface UseCodeMirrorResult {
  /** Ref callback attaching the editor to a host element. */
  attach: (element: HTMLDivElement | null) => void
  /** Imperative view access for toolbar commands (undo/find/format…). */
  getView: () => EditorView | null
}

/**
 * Thin lifecycle wrapper around CodeMirror 6 — deliberately no third-party
 * React binding.
 *
 * The view is created ONCE per pane lifetime and survives source-field
 * switches: the document, language and history are swapped through
 * compartments instead of remounting. Remounting per field was the defect-1
 * amplifier — a fresh view seeded mid-flush could resurrect stale text and
 * destroyed typing continuity. History is reset together with the language
 * so an undo after a switch can never drag a previous field's document into
 * the current one.
 *
 * Controlled-value updates are dispatched only when they actually differ
 * from the document, which prevents cursor jumps while typing. Formatting,
 * undo/redo and search all dispatch through this same view, so they can
 * never reset or bypass the draft contract.
 */
export function useCodeMirror(options: UseCodeMirrorOptions): UseCodeMirrorResult {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Last document string this hook emitted or received — the loop guard.
  const lastValueRef = useRef(options.value)
  // Last language configured into the view — drives compartment swaps.
  const lastLanguageRef = useRef(options.language)
  const onChangeRef = useRef(options.onChange)
  onChangeRef.current = options.onChange
  const statsRef = useRef(options.onStatsChange)
  statsRef.current = options.onStatsChange

  // Compartments are created once and live for the view's lifetime.
  const languageCompartmentRef = useRef(new Compartment())
  const historyCompartmentRef = useRef(new Compartment())
  const wrapCompartmentRef = useRef(new Compartment())
  const fontCompartmentRef = useRef(new Compartment())

  const emitStats = (view: EditorView): void => {
    const head = view.state.selection.main.head
    const line = view.state.doc.lineAt(head)
    statsRef.current?.({
      line: line.number,
      column: head - line.from + 1,
      selectedChars: view.state.selection.main.to - view.state.selection.main.from
    })
  }

  // The editor is constructed exactly once per pane mount; value/onChange/
  // language flow through refs plus the sync effects below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-time view construction; options flow via refs and the sync effects
  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: options.value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          historyCompartmentRef.current.of(history()),
          languageCompartmentRef.current.of(languageExtension(options.language)),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          // Provides the search state/panel required by searchKeymap and the
          // toolbar's Find/Replace commands.
          search(),
          wrapCompartmentRef.current.of([]),
          fontCompartmentRef.current.of(
            EditorView.theme({ '&': { fontSize: `${BASE_FONT_SIZE}px` } })
          ),
          htmlEditorHighlighting,
          htmlEditorTheme,
          keymap.of([
            ...(options.extraKeys ?? []),
            ...closeBracketsKeymap,
            ...searchKeymap,
            ...foldKeymap,
            ...defaultKeymap,
            ...historyKeymap
          ]),
          indentUnit.of('  '),
          EditorView.contentAttributes.of({ 'aria-label': options.ariaLabel }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const doc = update.state.doc.toString()
              lastValueRef.current = doc
              onChangeRef.current(doc)
            }
            if (update.docChanged || update.selectionSet) {
              emitStats(update.view)
            }
          })
        ]
      })
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // Field switches arrive as a changed language prop: swap the language
  // extension AND reset history so undo never crosses field boundaries.
  useEffect(() => {
    const view = viewRef.current
    if (!view || options.language === lastLanguageRef.current) {
      return
    }
    lastLanguageRef.current = options.language
    view.dispatch({
      effects: [
        languageCompartmentRef.current.reconfigure(languageExtension(options.language)),
        historyCompartmentRef.current.reconfigure(history())
      ]
    })
  }, [options.language])

  // External value sync (field switch, external reset). Skipped when the
  // incoming value equals what the editor last emitted, so typing never
  // resets the cursor.
  useEffect(() => {
    const view = viewRef.current
    if (!view || options.value === lastValueRef.current) {
      return
    }
    lastValueRef.current = options.value
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: options.value }
    })
  }, [options.value])

  // Word-wrap toggle reconfigures in place — never a remount, never a draft
  // reset.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: wrapCompartmentRef.current.reconfigure(
        options.wordWrap ? EditorView.lineWrapping : []
      )
    })
  }, [options.wordWrap])

  // Font-size changes reconfigure in place.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: fontCompartmentRef.current.reconfigure(
        EditorView.theme({ '&': { fontSize: `${options.fontSize}px` } })
      )
    })
  }, [options.fontSize])

  return {
    attach: (element: HTMLDivElement | null) => {
      hostRef.current = element
    },
    getView: () => viewRef.current
  }
}

export { BASE_FONT_SIZE }
