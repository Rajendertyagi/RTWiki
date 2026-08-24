import '@blocknote/core/fonts/inter.css'
import { MantineProvider } from '@mantine/core'
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@blocknote/mantine/style.css'
import '@mantine/core/styles.css'
import { App } from './App.js'
import { AppErrorBoundary } from './diagnostics/app-error-boundary.js'
import { configureDebugLoggingFromStorage } from './diagnostics/debug-log.js'
import { installGlobalErrorReporting } from './diagnostics/error-reporter.js'
import { rtwikiCssVariablesResolver, theme } from './theme/index.js'
// Centralized customization entry: loaded last so hierarchy/layout variables
// can override defaults without touching component CSS modules.
import './theme/customization.css'

// Report uncaught browser errors and promise rejections to the local
// diagnostics endpoint. Inner React boundaries mark their errors as handled,
// so the same failure is never reported twice.
installGlobalErrorReporting()

// Activate opt-in Debug Mode before the app renders so early events
// (session restoration, editor mounts) are captured when enabled.
configureDebugLoggingFromStorage()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('RTWiki: root element #root not found in index.html')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} cssVariablesResolver={rtwikiCssVariablesResolver}>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </MantineProvider>
  </React.StrictMode>
)
