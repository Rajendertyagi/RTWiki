import { Alert, Button, Stack, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { Component, type ReactNode } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { markHandled, reportClientError } from '../../diagnostics/error-reporter.js'
import classes from './rich-editor.module.css'

interface EditorErrorBoundaryProps {
  children: ReactNode
  /** Called when the owner chooses recovery; parent resets to a valid document. */
  onReset: () => void
  /** Remounts the editor with the same stored content (Retry). */
  onRetry?: () => void
  /** Returns to the pages dashboard without changing stored content. */
  onBack?: () => void
}

interface EditorErrorBoundaryState {
  errored: boolean
  diagnosticId: string | null
}

/**
 * Contains unexpected editor failures so a broken Rich Note can never blank
 * the whole application. Reports only safe, generic information — error
 * messages can embed stored page content, so neither the message nor the
 * stack is rendered or transmitted.
 */
export class EditorErrorBoundary extends Component<
  EditorErrorBoundaryProps,
  EditorErrorBoundaryState
> {
  override state: EditorErrorBoundaryState = { errored: false, diagnosticId: null }

  static getDerivedStateFromError(): Partial<EditorErrorBoundaryState> {
    return { errored: true }
  }

  override componentDidCatch(error: unknown): void {
    // Mark handled so window.error does not report this a second time.
    markHandled(error)
    const diagnosticId = reportClientError('react_error_boundary', {
      pageType: 'rich',
      component: 'RichEditorInner',
      error
    })
    this.setState({ errored: true, diagnosticId })
  }

  private readonly handleReset = (): void => {
    this.setState({ errored: false, diagnosticId: null })
    this.props.onReset()
  }

  private readonly handleRetry = (): void => {
    this.setState({ errored: false, diagnosticId: null })
    this.props.onRetry?.()
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
        <Stack gap="xs">
          <Button variant="light" color="orange" onClick={this.handleRetry}>
            {UI_TEXT.retry}
          </Button>
          {this.props.onBack ? (
            <Button variant="subtle" color="gray" onClick={this.props.onBack}>
              {UI_TEXT.backToDashboard}
            </Button>
          ) : null}
          <Button variant="light" color="red" onClick={this.handleReset}>
            {UI_TEXT.richEditorResetButton}
          </Button>
        </Stack>
        <Text size="xs" c="dimmed">
          {UI_TEXT.richEditorLogLocation}
        </Text>
        {this.state.diagnosticId ? (
          <Text size="xs" c="dimmed" data-testid="diagnostic-reference">
            {UI_TEXT.richEditorReferenceLabel}: {this.state.diagnosticId}
          </Text>
        ) : null}
      </Stack>
    )
  }
}
