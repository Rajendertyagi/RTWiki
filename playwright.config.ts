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
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure'
  },
  // Cold BlockNote mounts on CI runners can exceed the default 5s.
  expect: { timeout: 15_000 },
  webServer: {
    // PLAYWRIGHT_PORT keeps local runs off a port owned by another RTWiki
    // instance; the flag is forwarded so single-instance detection probes
    // the same port the server will actually bind.
    command: `bun src/server/index.ts --no-open${PORT === 8080 ? '' : ` --port ${PORT}`}`,
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 30_000
  }
})
