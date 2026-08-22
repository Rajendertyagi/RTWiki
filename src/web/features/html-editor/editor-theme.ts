import { syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { classHighlighter } from '@lezer/highlight'

/**
 * CodeMirror chrome theme built exclusively on Mantine CSS variables, so the
 * editor follows the application color scheme without any JS-side theming.
 * Syntax token colors come from `classHighlighter`: tokens receive stable
 * classes (`.tok-keyword`, `.tok-string`, …) that are styled per color scheme
 * in `html-editor.module.css`.
 */
export const htmlEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--mantine-font-size-sm)',
    backgroundColor: 'transparent',
    color: 'var(--mantine-color-text)'
  },
  '.cm-scroller': {
    fontFamily: 'var(--mantine-font-family-monospace)',
    lineHeight: 1.55,
    overflow: 'auto'
  },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--mantine-color-text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--mantine-color-text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--mantine-color-text) 15%, transparent)'
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--mantine-color-text) 5%, transparent)'
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--mantine-color-dimmed)'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--mantine-color-text) 5%, transparent)',
    color: 'var(--mantine-color-text)'
  },
  '.cm-selectionMatch': {
    backgroundColor: 'color-mix(in srgb, var(--mantine-color-text) 10%, transparent)'
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--mantine-color-yellow) 30%, transparent)',
    outline: '1px solid var(--mantine-color-yellow-outline)'
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--mantine-color-body)',
    border: '1px solid var(--mantine-color-default-border)',
    borderRadius: 'var(--mantine-radius-sm)'
  },
  '.cm-panels': {
    backgroundColor: 'var(--mantine-color-body)',
    color: 'var(--mantine-color-text)',
    borderBottom: '1px solid var(--mantine-color-default-border)'
  }
})

/** Class-based highlighting so token colors live in our CSS module. */
export const htmlEditorHighlighting = syntaxHighlighting(classHighlighter)
