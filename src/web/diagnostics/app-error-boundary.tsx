import { Alert, Button, Stack, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { Component, type ReactNode } from 'react'
import { UI_TEXT } from '../config/index.js'
import { markHandled, reportClientError } from './error-reporter.js'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  errored: boolean
}

/**
 * Top-level safety net. Any component failure that escapes inner boundaries
 * renders this recovery panel instead of blanking the whole application.
 * The failure is reported once through the sanitized diagnostics reporter;
 * no error message, stack trace, or page data is ever rendered.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { errored: false }

  static getDerivedStateFromError(): Partial<AppErrorBoundaryState> {
    return { errored: true }
  }

  override componentDidCatch(error: unknown): void {
    // Mark handled so window.error does not report this a second time.
    markHandled(error)
    reportClientError('react_error_boundary', { component: 'AppRoot', error })
  }

  private readonly handleReload = (): void => {
    window.location.reload()
  }

  override render(): ReactNode {
    if (!this.state.errored) {
      return this.props.children
    }

    return (
      <Stack align="center" justify="center" h="100vh" gap="md">
        <Alert
          icon={<IconAlertTriangle size={20} />}
          color="orange"
          title={UI_TEXT.appCrashTitle}
          variant="light"
        >
          <Text size="sm">{UI_TEXT.appCrashMessage}</Text>
        </Alert>
        <Button variant="light" color="orange" onClick={this.handleReload}>
          {UI_TEXT.appCrashReload}
        </Button>
      </Stack>
    )
  }
}
