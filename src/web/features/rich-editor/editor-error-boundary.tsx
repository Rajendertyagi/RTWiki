import { Alert, Button, Stack, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { Component, type ReactNode } from 'react'
import { UI_TEXT } from '../../config/index.js'
import classes from './rich-editor.module.css'

interface EditorErrorBoundaryProps {
  children: ReactNode
  /** Called when the owner chooses recovery; parent resets to a valid document. */
  onReset: () => void
}

interface EditorErrorBoundaryState {
  errored: boolean
}

/**
 * Contains unexpected editor failures so a broken Rich Note can never blank
 * the whole application. Reports only a safe, generic message — error messages
 * can embed stored page content, so neither the message nor stack is rendered.
 */
export class EditorErrorBoundary extends Component<
  EditorErrorBoundaryProps,
  EditorErrorBoundaryState
> {
  override state: EditorErrorBoundaryState = { errored: false }

  static getDerivedStateFromError(): Partial<EditorErrorBoundaryState> {
    return { errored: true }
  }

  override componentDidCatch(error: unknown): void {
    // Log the error class only — messages may contain page content.
    const kind = error instanceof Error ? error.name : 'unknown'
    console.error(`[rtwiki-editor] contained editor failure (${kind})`)
  }

  private readonly handleReset = (): void => {
    this.setState({ errored: false })
    this.props.onReset()
  }

  override render(): ReactNode {
    if (!this.state.errored) {
      return this.props.children
    }

    return (
      <Stack gap="md" className={classes.editorRoot}>
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="orange"
          title={UI_TEXT.richEditorCrashTitle}
          variant="light"
        >
          <Text size="sm">{UI_TEXT.richEditorCrashMessage}</Text>
          <Text size="xs" c="dimmed" mt="xs">
            {UI_TEXT.richEditorPreserveNotice}
          </Text>
        </Alert>
        <Button variant="light" color="orange" onClick={this.handleReset}>
          {UI_TEXT.richEditorResetButton}
        </Button>
      </Stack>
    )
  }
}
