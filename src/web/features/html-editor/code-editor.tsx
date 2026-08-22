import classes from './code-editor.module.css'
import { type CodeEditorLanguage, useCodeMirror } from './use-codemirror.js'

export interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language: CodeEditorLanguage
  /** Accessible name for the editable region. */
  label: string
  /** Extra key bindings; return true to mark a keystroke handled. */
  extraKeys?: Array<{ key: string; run: () => boolean }>
}

/**
 * A single CodeMirror pane (HTML, CSS or JavaScript). Purely presentational:
 * state lives in the workspace so values survive tab switches.
 */
export function CodeEditor(props: CodeEditorProps): JSX.Element {
  const attach = useCodeMirror({
    value: props.value,
    onChange: props.onChange,
    language: props.language,
    ariaLabel: props.label,
    extraKeys: props.extraKeys
  })
  return (
    <div
      ref={attach}
      className={classes.host}
      data-testid={`code-editor-${props.language}`}
    />
  )
}
