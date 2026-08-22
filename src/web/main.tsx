import '@blocknote/core/fonts/inter.css'
import { MantineProvider } from '@mantine/core'
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@blocknote/mantine/style.css'
import '@mantine/core/styles.css'
import { App } from './App.js'
import { AppErrorBoundary } from './diagnostics/app-error-boundary.js'
import { installGlobalErrorReporting } from './diagnostics/error-reporter.js'
import { rtwikiCssVariablesResolver, theme } from './theme/index.js'

// Report uncaught browser errors and promise rejections to the local
// diagnostics endpoint. Inner React boundaries mark their errors as handled,
// so the same failure is never reported twice.
installGlobalErrorReporting()

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
