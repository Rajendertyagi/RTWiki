import { useEffect } from 'react'
import classes from './code-editor.module.css'
import {
  type CodeEditorLanguage,
  type EditorStats,
  type UseCodeMirrorResult,
  useCodeMirror
} from './use-codemirror.js'

export interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language: CodeEditorLanguage
  /** Accessible name for the editable region. */
  label: string
  /** Word-wrap toggle (toolbar-controlled). */
  wordWrap?: boolean
  /** Editor font size in px (toolbar-controlled). */
  fontSize?: number
  /** Receives caret/selection statistics for the status row. */
  onStatsChange?: (stats: EditorStats) => void
  /** Receives the imperative view accessor for toolbar commands. */
  onViewAccessor?: (accessor: UseCodeMirrorResult['getView']) => void
  /** Extra key bindings; return true to mark a keystroke handled. */
  extraKeys?: Array<{ key: string; run: () => boolean }>
}

/**
 * A single CodeMirror pane (HTML, CSS or JavaScript). Purely presentational:
 * state lives in the workspace so values survive tab switches.
 */
export function CodeEditor(props: CodeEditorProps): JSX.Element {
  const { attach, getView } = useCodeMirror({
    value: props.value,
    onChange: props.onChange,
    language: props.language,
    ariaLabel: props.label,
    wordWrap: props.wordWrap ?? true,
    fontSize: props.fontSize ?? 14,
    onStatsChange: props.onStatsChange,
    extraKeys: props.extraKeys
  })

  // Hand the imperative accessor up once; the parent keeps it in a ref so
  // toolbar buttons can dispatch into this exact view instance.
  useEffect(() => {
    props.onViewAccessor?.(getView)
  }, [getView, props.onViewAccessor])

  return <div ref={attach} className={classes.host} data-testid={`code-editor-${props.language}`} />
}
