import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView, keymap, lineNumbers } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { htmlEditorHighlighting, htmlEditorTheme } from './editor-theme.js'

export type CodeEditorLanguage = 'html' | 'css' | 'javascript'

function languageExtension(language: CodeEditorLanguage): Extension {
  switch (language) {
    case 'html':
      return html()
    case 'css':
      return css()
    case 'javascript':
      return javascript()
  }
}

export interface UseCodeMirrorOptions {
  /** Controlled document value. */
  value: string
  onChange: (value: string) => void
  language: CodeEditorLanguage
  /** Accessible name announced for the editable region. */
  ariaLabel: string
  /** Extra key bindings; return true to mark a keystroke handled. */
  extraKeys?: Array<{ key: string; run: () => boolean }>
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
 * from the document, which prevents cursor jumps while typing.
 */
export function useCodeMirror(
  options: UseCodeMirrorOptions
): (element: HTMLDivElement | null) => void {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Last document string this hook emitted or received — the loop guard.
  const lastValueRef = useRef(options.value)
  // Last language configured into the view — drives compartment swaps.
  const lastLanguageRef = useRef(options.language)
  const onChangeRef = useRef(options.onChange)
  onChangeRef.current = options.onChange

  // Compartments are created once and live for the view's lifetime.
  const languageCompartmentRef = useRef(new Compartment())
  const historyCompartmentRef = useRef(new Compartment())

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
          historyCompartmentRef.current.of(history()),
          languageCompartmentRef.current.of(languageExtension(options.language)),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          bracketMatching(),
          htmlEditorHighlighting,
          htmlEditorTheme,
          keymap.of([...(options.extraKeys ?? []), ...defaultKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of({ 'aria-label': options.ariaLabel }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return
            }
            const doc = update.state.doc.toString()
            lastValueRef.current = doc
            onChangeRef.current(doc)
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

  return (element: HTMLDivElement | null) => {
    hostRef.current = element
  }
}
