import { existsSync } from 'node:fs'
import { bootstrap, type Runtime } from './bootstrap.js'
import { resolveRuntimePaths } from './config/index.js'
import { reportFatalStartupError } from './fatal.js'
import { createLogger } from './logging/index.js'

interface CliFlags {
  smokeTest: boolean
  noOpen: boolean
  /** Overrides the default listening port (8080). */
  port?: number
  /**
   * Overrides the data directory. **Test and automation use only.**
   *
   * Not an environment variable and not AppData, so the portable-layout rule is
   * untouched, and absent means the single documented behaviour: the data
   * directory beside the executable. This exists because the browser suite needs
   * a database it can create pages in and throw away, and it had no way to get
   * one — the web server it starts used the real `data/` directory, so every run
   * added pages to the user's own database. That is why the development database
   * held thousands of test pages, and why tree and dashboard lookups started
   * timing out: the sidebar virtualises, so a freshly seeded page was landing
   * outside the rendered window.
   *
   * `bootstrap({ dataDir })` already existed and was already used by the unit
   * tests; this only exposes it to the harness that needed it all along.
   */
  dataDir?: string
}

function parseArgs(argv: string[]): CliFlags {
  let port: number | undefined
  const portIndex = argv.indexOf('--port')
  if (portIndex >= 0) {
    const raw = argv[portIndex + 1]
    const parsed = raw === undefined ? Number.NaN : Number(raw)
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535) {
      port = parsed
    }
  }
  const dataDirIndex = argv.indexOf('--data-dir')
  const dataDirRaw = dataDirIndex >= 0 ? argv[dataDirIndex + 1] : undefined
  return {
    smokeTest: argv.includes('--smoke-test'),
    noOpen: argv.includes('--no-open'),
    port,
    // A flag with no value is ignored rather than becoming an empty string,
    // which would resolve to the current directory and put a database somewhere
    // surprising.
    dataDir: dataDirRaw === undefined || dataDirRaw.length === 0 ? undefined : dataDirRaw
  }
}

/**
 * Self-contained smoke test used by CI on the compiled Windows executable.
 * Boots the full stack with the browser launcher disabled, exercises the HTTP
 * health + frontend endpoints, verifies runtime directories exist, then
 * performs a clean shutdown. Exits 0 on success, 1 on any failure.
 *
 * Every failure path closes the logger before returning so buffered-free
 * synchronous writes are guaranteed to be on disk.
 */
async function runSmokeTest(): Promise<number> {
  const logger = createLogger(resolveRuntimePaths().logPath)
  let runtime: Runtime | null = null
  try {
    runtime = await bootstrap({ logger, openBrowser: false })
    const { paths } = runtime

    const healthRes = await runtime.server.fetch(new Request('http://127.0.0.1:8080/health'))
    if (healthRes.status !== 200) {
      logger.error('Smoke test failed: health endpoint not ok', {
        event: 'smoke',
        status: healthRes.status
      })
      await logger.close()
      return 1
    }

    const rootRes = await runtime.server.fetch(new Request('http://127.0.0.1:8080/'))
    if (rootRes.status !== 200) {
      logger.error('Smoke test failed: frontend root not served', {
        event: 'smoke',
        status: rootRes.status
      })
      await logger.close()
      return 1
    }

    if (!existsSync(paths.dataDir) || !existsSync(paths.logDir)) {
      logger.error('Smoke test failed: runtime directories missing', { event: 'smoke' })
      await logger.close()
      return 1
    }

    logger.info('Smoke test passed', { event: 'smoke' })

    // Perform clean shutdown via coordinator; it closes the logger last.
    const result = await runtime.coordinator.requestShutdown()
    return result.ok ? 0 : 1
  } catch (err) {
    logger.error('Smoke test error', {
      event: 'smoke',
      error: err instanceof Error ? err.message : String(err)
    })
    await logger.close()
    return 1
  }
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2))

  if (flags.smokeTest) {
    process.exitCode = await runSmokeTest()
    return
  }

  const runtime = await bootstrap({
    openBrowser: !flags.noOpen,
    ...(flags.port === undefined ? {} : { port: flags.port }),
    ...(flags.dataDir === undefined ? {} : { dataDir: flags.dataDir })
  })

  // If an existing instance was detected, bootstrap returns a null server.
  // The browser was already opened (if applicable) and its exit message was
  // logged and persisted inside bootstrap before the logger closed there.
  if (!runtime.server) {
    process.exitCode = 0
    return
  }

  runtime.logger.info('RTWiki initialized', { event: 'startup' })

  const onSigint = (): void => {
    void runtime.coordinator.requestShutdown()
  }
  const onSigterm = (): void => {
    void runtime.coordinator.requestShutdown()
  }

  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)

  // Await the coordinator's completion — either HTTP-triggered or signal-triggered.
  const result = await runtime.coordinator.completed

  // Remove listeners so they don't fire again if somehow re-registered.
  process.removeListener('SIGINT', onSigint)
  process.removeListener('SIGTERM', onSigterm)

  // Set exit code based on shutdown result; exit naturally.
  process.exitCode = result.ok ? 0 : 1
}

main().catch(async (err) => {
  await reportFatalStartupError(err)
  process.exitCode = 1
})
