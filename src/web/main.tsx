import { MantineProvider } from '@mantine/core'
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@mantine/core/styles.css'
import { App } from './App.js'
import { theme } from './theme/index.js'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('RTWiki: root element #root not found in index.html')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme}>
      <App />
    </MantineProvider>
  </React.StrictMode>
)
