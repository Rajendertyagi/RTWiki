import { Alert, Button, Stack, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { Component, type ReactNode } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { markHandled, reportClientError } from '../../diagnostics/error-reporter.js'
import classes from './rich-editor.module.css'

interface EditorErrorBoundaryProps {
  children: ReactNode
  /**
   * Called only after the user confirms the reset. It replaces the page's stored
   * content, and RTWiki keeps no backup copy of it, so it must never be reachable
   * from the first click of the reset control.
   */
  onReset: () => void
  /** Remounts the editor with the same stored content (Retry). */
  onRetry?: () => void
  /** Returns to the pages dashboard without changing stored content. */
  onBack?: () => void
}

interface EditorErrorBoundaryState {
  errored: boolean
  diagnosticId: string | null
  /**
   * Set by the first press of the reset control and cleared by every exit from
   * the recovery screen. `onReset` is reachable only while this is true, which
   * is what makes the reset a two-step action.
   */
  resetArmed: boolean
}

/**
 * The confirmation that stands in front of the Rich Note's only destructive
 * action: replacing the page's stored content with an empty document. RTWiki
 * keeps no backup copy of page content, so a reset cannot be undone.
 *
 * Rendered by *both* recovery screens — the contained-crash screen below and the
 * malformed-content screen in `rich-editor.tsx` — so the two paths cannot drift
 * apart again. It holds no state of its own: the owner arms it and supplies the
 * callbacks, and only the explicit confirm button is wired to the destructive
 * one.
 */
export function ResetConfirmation({
  onConfirm,
  onCancel
}: {
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <Stack gap="xs" data-testid="reset-confirmation">
      <Text size="sm" fw={500}>
        {UI_TEXT.richEditorResetConfirmWarning}
      </Text>
      <Button color="red" onClick={onConfirm} data-testid="reset-confirm-apply">
        {UI_TEXT.richEditorResetConfirmButton}
      </Button>
      <Button variant="subtle" onClick={onCancel} data-testid="reset-confirm-cancel">
        {UI_TEXT.cancelButton}
      </Button>
    </Stack>
  )
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
  override state: EditorErrorBoundaryState = {
    errored: false,
    diagnosticId: null,
    resetArmed: false
  }

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
    this.setState({ errored: true, diagnosticId, resetArmed: false })
  }

  /**
   * First press of the reset control. Arms the confirmation and nothing else:
   * `onReset` is deliberately not reachable from here.
   */
  private readonly handleResetRequest = (): void => {
    this.setState({ resetArmed: true })
  }

  private readonly handleResetCancel = (): void => {
    this.setState({ resetArmed: false })
  }

  private readonly handleResetConfirm = (): void => {
    this.setState({ errored: false, diagnosticId: null, resetArmed: false })
    this.props.onReset()
  }

  private readonly handleRetry = (): void => {
    this.setState({ errored: false, diagnosticId: null, resetArmed: false })
    this.props.onRetry?.()
  }

  private readonly handleBack = (): void => {
    this.setState({ resetArmed: false })
    this.props.onBack?.()
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
            {UI_TEXT.richEditorCrashRecoveryNotice}
          </Text>
        </Alert>
        <Stack gap="xs">
          <Button variant="light" color="orange" onClick={this.handleRetry}>
            {UI_TEXT.retry}
          </Button>
          {this.props.onBack ? (
            <Button variant="subtle" color="gray" onClick={this.handleBack}>
              {UI_TEXT.backToDashboard}
            </Button>
          ) : null}
          {this.state.resetArmed ? (
            <ResetConfirmation
              onConfirm={this.handleResetConfirm}
              onCancel={this.handleResetCancel}
            />
          ) : (
            <Button
              variant="light"
              color="red"
              onClick={this.handleResetRequest}
              data-testid="reset-request"
            >
              {UI_TEXT.richEditorResetButton}
            </Button>
          )}
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
