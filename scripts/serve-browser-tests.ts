/**
 * Starts RTWiki for the browser test suite, against a throwaway data directory.
 *
 * ## Why this exists
 *
 * The Playwright `webServer` used to run `src/server/index.ts` with no data
 * directory override, so the server under test used the **real** `data/`
 * directory — the user's own `rtwiki.sqlite`. Every run created pages and never
 * removed them.
 *
 * That is not a tidiness problem, it is a correctness problem. The page tree
 * virtualises (`wb-tree-host.ts`), so a freshly seeded page eventually lands
 * outside the rendered window and any spec that looks it up in the tree or on the
 * dashboard times out — and the failures look like product bugs. The development
 * database accumulated several thousand such pages, and the suite's results
 * depended on how many runs had come before.
 *
 * A clean directory per run makes the suite reproducible and stops it writing to
 * the real database. It does **not** delete the pages already there: that is the
 * user's data and clearing it is a separate, deliberate act.
 *
 * Logs still go to the real `logs/` directory, because a failing run's log is
 * exactly what is wanted afterwards. The logger is resolved before the data
 * directory is substituted.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bootstrap } from '../src/server/bootstrap.js'
import { resolveRuntimePaths } from '../src/server/config/index.js'
import { createLogger } from '../src/server/logging/index.js'

const dataDir = resolve(process.argv[2] ?? join(resolveRuntimePaths().dataDir, '.playwright'))
const port = Number(process.argv[3] ?? '8123')

// A fixed path rather than a random one, so a rerun starts from the same place
// and a crashed run leaves something a human can inspect.
if (existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true })
}
mkdirSync(dataDir, { recursive: true })

const logger = createLogger(resolveRuntimePaths().logPath)
const runtime = await bootstrap({
  logger,
  openBrowser: false,
  port,
  dataDir
})

if (!runtime.server) {
  // Bootstrap found an instance already owning the port, so there is nothing to
  // test against. Exiting non-zero makes Playwright report the port clash
  // instead of hanging on a health check that will never pass.
  process.stderr.write(`playwright server: port ${port} already in use\n`)
  await logger.close()
  process.exit(1)
}

const stop = async (): Promise<void> => {
  await runtime.coordinator.requestShutdown()
}

process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
