import '@blocknote/core/fonts/inter.css'
import { MantineProvider } from '@mantine/core'
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@blocknote/mantine/style.css'
import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/schedule/styles.css'
import '@mantine/notifications/styles.css'
/*
 * KaTeX's stylesheet, imported from the **entry** rather than from
 * `markdown-workspace.tsx` where it used to live.
 *
 * ## Why it moved: measured, not tidiness
 *
 * At `122e172` this built to its own eager `katex-*.css`. It stopped doing so once
 * syntax highlighting was added, and the cause is a chunk-graph cycle:
 *
 * ```text
 *   markdown-workspace ──imports──▶ katex.min.css
 *         │
 *         └──imports──▶ attachCodeHighlighting ──▶ shiki-service ──▶ shiki/core
 * ```
 *
 * Vite put both in one chunk, so `katex.min.css` was emitted as part of the **lazy**
 * `shiki-service-*.css`. Verified in the built output: it was the only stylesheet
 * containing `.katex-mathml`, and the served `<link>` list carries only
 * `index-*.css`.
 *
 * ## What that looks like to a reader
 *
 * KaTeX's `.katex-mathml` is the MathML subtree that exists for **screen readers
 * only**; its CSS hides it from the page. With the stylesheet absent, that subtree
 * renders visibly, so every formula shows its glyph-by-glyph letterforms *and* the
 * rendered maths side by side. Measured on the running app: "Sectionformula" spelled
 * out one letter per line, beside `(mx₂+nx₁)/(m+n)`.
 *
 * ## Why the entry
 *
 * A note's maths must look right the moment the page is readable, and it must not
 * depend on whether a code fence happened to trigger the highlighter. Only the entry
 * chunk is loaded unconditionally, so this is the one import site that cannot be
 * made lazy. The duplicate import in `markdown-workspace.tsx` is kept — a bare import
 * of a plain `.css` is idempotent — so that module remains correct if it is ever
 * loaded in a context without this entry.
 */
import 'katex/dist/katex.min.css'
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
