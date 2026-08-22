import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import {
  EditorState,
  type Extension
} from '@codemirror/state'
import { EditorView, drawSelection, dropCursor, keymap, lineNumbers } from '@codemirror/view'
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
 * React binding. The view is created once per mount and disposed on unmount;
 * controlled-value updates are dispatched only when they actually differ
 * from the document, which prevents cursor jumps while typing.
 */
export function useCodeMirror(options: UseCodeMirrorOptions): (element: HTMLDivElement | null) => void {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Last document string this hook emitted or received — the loop guard.
  const lastValueRef = useRef(options.value)
  const onChangeRef = useRef(options.onChange)
  onChangeRef.current = options.onChange

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
          history(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          bracketMatching(),
          htmlEditorHighlighting,
          htmlEditorTheme,
          languageExtension(options.language),
          keymap.of([
            ...(options.extraKeys ?? []),
            ...defaultKeymap,
            ...historyKeymap
          ]),
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
    // The editor is created once per pane mount; value/onChange flow through
    // refs and the sync effect below. Language never changes per mount.
    // biome-ignore lint/correctness/useExhaustiveDependencies: one-time construction; options flow via refs
  }, [])

  // External value sync (page switch, reset, reload merge). Skipped when the
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
