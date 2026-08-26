import { defineConfig } from '@playwright/test'

// Overridable so local runs can coexist with another RTWiki instance that
// already owns the default port (CI leaves this unset and uses 8080).
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 8080)
const baseURL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/browser',
  // .pwspec.ts keeps the Playwright suite out of `bun test` discovery
  // (bun matches *.spec.* and cannot run Playwright's describe registry).
  testMatch: '**/*.pwspec.ts',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  expect: { timeout: 15_000 },
  // Region screenshots live beside their specs, per platform+browser.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{platform}/{arg}{ext}',
  webServer: {
    // The supervisor respawns the real server when an owner journey exercises
    // the app's own shutdown endpoint, making genuine restarts testable.
    command: `bun scripts/dev-supervisor.ts${PORT === 8080 ? '' : ` --port ${PORT}`}`,
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 30_000
  }
})
