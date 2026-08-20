import { bootstrap, type Runtime } from './bootstrap.js'
import { app } from './app.js'
import { createLogger } from './logging/index.js'
import { resolveRuntimePaths } from './config/index.js'
import { existsSync } from 'node:fs'

interface CliFlags {
  smokeTest: boolean
  noOpen: boolean
}

function parseArgs(argv: string[]): CliFlags {
  return {
    smokeTest: argv.includes('--smoke-test'),
    noOpen: argv.includes('--no-open')
  }
}

/**
 * Self-contained smoke test used by CI on the compiled Windows executable.
 * Boots the full stack with the browser launcher disabled, exercises the HTTP
 * health + frontend endpoints, and verifies runtime directories exist, then
 * performs a clean shutdown. Exits 0 on success, 1 on any failure.
 */
async function runSmokeTest(): Promise<number> {
  const logger = createLogger(resolveRuntimePaths().logPath)
  let runtime: Runtime | null = null
  try {
    runtime = await bootstrap({ logger, openBrowser: false })
    const { paths } = runtime

    const healthRes = await app.fetch(new Request('http://127.0.0.1:8080/health'))
    if (healthRes.status !== 200) {
      logger.error('Smoke test failed: health endpoint not ok', {
        event: 'smoke',
        status: healthRes.status
      })
      return 1
    }

    const rootRes = await app.fetch(new Request('http://127.0.0.1:8080/'))
    if (rootRes.status !== 200) {
      logger.error('Smoke test failed: frontend root not served', {
        event: 'smoke',
        status: rootRes.status
      })
      return 1
    }

    if (!existsSync(paths.dataDir) || !existsSync(paths.logDir)) {
      logger.error('Smoke test failed: runtime directories missing', { event: 'smoke' })
      return 1
    }

    logger.info('Smoke test passed', { event: 'smoke' })
    return 0
  } catch (err) {
    logger.error('Smoke test error', {
      event: 'smoke',
      error: err instanceof Error ? err.message : String(err)
    })
    return 1
  } finally {
    if (runtime) await runtime.shutdown()
  }
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2))

  if (flags.smokeTest) {
    process.exit(await runSmokeTest())
  }

  const runtime = await bootstrap({ openBrowser: !flags.noOpen })

  // If an existing instance was detected, bootstrap returns a null server.
  // The browser was already opened (if applicable). Exit cleanly.
  if (!runtime.server) {
    runtime.logger.info('Exiting: existing RTWiki instance already running', {
      event: 'single_instance'
    })
    process.exit(0)
  }

  runtime.logger.info('RTWiki initialized', { event: 'startup' })

  let shuttingDown = false
  const handleSignal = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    runtime.logger.info('Signal received', { event: 'shutdown', signal })
    try {
      await runtime.shutdown()
    } catch (err) {
      runtime.logger.error('Shutdown error', {
        event: 'shutdown',
        error: err instanceof Error ? err.message : String(err)
      })
    }
    process.exit(0)
  }

  process.on('SIGINT', () => void handleSignal('SIGINT'))
  process.on('SIGTERM', () => void handleSignal('SIGTERM'))

  // Keep the process alive until a termination signal arrives.
  await new Promise<void>(() => {})
}

main().catch((err) => {
  const logger = createLogger(resolveRuntimePaths().logPath)
  logger.error('Fatal startup failure', {
    event: 'startup',
    error: err instanceof Error ? err.message : String(err)
  })
  process.exit(1)
})
