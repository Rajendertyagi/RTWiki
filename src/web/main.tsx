import '@blocknote/core/fonts/inter.css'
import { MantineProvider } from '@mantine/core'
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@blocknote/mantine/style.css'
import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/schedule/styles.css'
import '@mantine/notifications/styles.css'
import { App } from './App.js'
import { AppErrorBoundary } from './diagnostics/app-error-boundary.js'
import { configureDebugLoggingFromStorage } from './diagnostics/debug-log.js'
import { installGlobalErrorReporting } from './diagnostics/error-reporter.js'
import { createThemeCssVariablesResolver, resolveActiveTheme } from './theme/index.js'
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

// The active theme supplies both the Mantine override and the region-named
// surface variables. The light/dark variant is selected by Mantine's own
// `data-mantine-color-scheme` attribute.
const activeTheme = resolveActiveTheme()

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <MantineProvider
      theme={activeTheme.mantine}
      cssVariablesResolver={createThemeCssVariablesResolver(activeTheme)}
      // Follow the operating system until the user says otherwise.
      //
      // Without this, MantineProvider defaults to 'light' and the app rendered a
      // light interface on a machine set to dark, however the OS was configured.
      // 'auto' is only the *initial* value: once the user picks Light or Dark in
      // Settings, Mantine persists that choice and it wins from then on, which
      // is why no separate stored-preference lookup is needed here.
      defaultColorScheme="auto"
    >
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </MantineProvider>
  </React.StrictMode>
)
