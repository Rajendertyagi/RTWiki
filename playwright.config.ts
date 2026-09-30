/*
 * biome-ignore-all lint/correctness/noNodejsModules: this file runs in Node, not the
 * browser. `node:os` and `node:path` place the test server's throwaway data directory
 * under the OS temp dir. The rule exists so browser code cannot reach for Node
 * built-ins, and a Playwright config is one of the few places they belong — the file
 * would not load without them.
 */
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

// Overridable so local runs can coexist with another RTWiki instance that
// already owns the default port (CI leaves this unset and uses 8080).
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 8080)
const baseURL = `http://127.0.0.1:${PORT}`

/**
 * A throwaway data directory for the server under test.
 *
 * The suite used to run against the real `data/` directory, so every run created
 * pages in the user's own database and none were removed. That is not merely
 * untidy: the page tree virtualises, so once the database held enough pages a
 * freshly seeded one fell outside the rendered window and tree and dashboard
 * lookups timed out — so the suite's results depended on how many runs preceded
 * it, and failures looked like product bugs. A clean directory per run makes
 * results reproducible and stops the suite writing to real data.
 *
 * Fixed path, not random, so a rerun starts identically and a crashed run leaves
 * something inspectable. `scripts/serve-browser-tests.ts` clears and recreates it.
 */
const TEST_DATA_DIR = resolve(
  process.env.PLAYWRIGHT_DATA_DIR ?? join(tmpdir(), 'rtwiki-playwright-data')
)

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
    // A wrapper script rather than `src/server/index.ts` directly, because the
    // server under test needs a data directory it is free to destroy. The port is
    // forwarded so single-instance detection probes the port actually bound.
    command: `bun scripts/serve-browser-tests.ts "${TEST_DATA_DIR}" ${PORT}`,
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 30_000
  }
})
