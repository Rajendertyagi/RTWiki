import { Alert, Button, Stack, Text } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { markHandled, reportClientError } from '../../diagnostics/error-reporter.js'

interface HtmlEditorErrorBoundaryProps {
  children: ReactNode
  /** Returns to the pages dashboard. */
  onBack?: () => void
}

interface HtmlEditorErrorBoundaryState {
  attempt: number
  failed: boolean
}

/**
 * Contains failures of the lazily loaded HTML editor (including chunk-load
 * errors) so the rest of RTWiki keeps working. Recovery remounts the editor;
 * nothing here exposes error text, paths, tokens or page content.
 */
export class HtmlEditorErrorBoundary extends Component<
  HtmlEditorErrorBoundaryProps,
  HtmlEditorErrorBoundaryState
> {
  state: HtmlEditorErrorBoundaryState = { attempt: 0, failed: false }

  static getDerivedStateFromError(): Partial<HtmlEditorErrorBoundaryState> {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    markHandled(error)
    reportClientError('react_error_boundary', {
      pageType: 'html',
      component: 'HtmlEditorErrorBoundary',
      error
    })
    void info
  }

  private readonly retry = (): void => {
    this.setState((prev) => ({ failed: false, attempt: prev.attempt + 1 }))
  }

  render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children
    }
    return (
      <Stack gap="md" p="md" data-testid="html-editor-recovery">
        <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
          <Text size="sm">{UI_TEXT.htmlEditorCrashMessage}</Text>
          <Text size="xs" c="dimmed" mt="xs">
            {UI_TEXT.htmlPreviewPreservedNotice}
          </Text>
        </Alert>
        <Stack gap="xs">
          <Button variant="light" onClick={this.retry}>
            {UI_TEXT.retry}
          </Button>
          {this.props.onBack ? (
            <Button variant="subtle" onClick={this.props.onBack}>
              {UI_TEXT.backToDashboard}
            </Button>
          ) : null}
        </Stack>
      </Stack>
    )
  }
}
