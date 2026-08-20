import { app } from './app.js'
import { resolveRuntimePaths } from './config/index.js'
import { createLogger, type Logger } from './logging/index.js'
import { initDatabase, closeDatabase, checkIntegrity, type Database } from './database/index.js'
import { runMigrations } from './database/migrations.js'
import { launchBrowser, type Launcher } from './launcher.js'
import { setShutdownHandler } from './routes/shutdown.js'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface BootstrapOptions {
  logger?: Logger
  launcher?: Launcher
  openBrowser?: boolean
  /** Listening port. Defaults to 8080; tests may pass a free port to avoid conflicts. */
  port?: number
}

export interface Runtime {
  server: Awaited<ReturnType<typeof Bun.serve>>
  logger: Logger
  paths: ReturnType<typeof resolveRuntimePaths>
  db: Database
  shutdownToken: string
  shutdown: () => Promise<void>
}

export interface ExistingInstanceResult {
  detected: true
  url: string
}

/**
 * Probes the port to detect whether an existing RTWiki instance is already running.
 *
 * Returns `null` if the port is free or occupied by a different application.
 * Returns `{ detected: true, url }` if an existing RTWiki instance responds.
 */
async function probeExistingInstance(
  port: number,
  logger: Logger
): Promise<ExistingInstanceResult | null> {
  const url = `http://127.0.0.1:${port}/health`
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>
      if (body.app === 'RTWiki') {
        logger.info('Existing RTWiki instance detected', {
          event: 'single_instance',
          port,
          detected: true
        })
        return { detected: true, url: `http://127.0.0.1:${port}/` }
      }
    }

    // Port is occupied by a different application (responded but not RTWiki).
    logger.warn('Port occupied by different application', {
      event: 'single_instance',
      port,
      detected: false,
      status: res.status
    })
    return null
  } catch {
    // No response — port is free or connection refused. Proceed with startup.
    return null
  }
}

/**
 * Composition root: owns the config, logger, database, and HTTP server singletons.
 * The caller (index.ts) wires signal handlers and triggers shutdown.
 */
export async function bootstrap(options: BootstrapOptions = {}): Promise<Runtime> {
  const port = options.port ?? 8080
  const paths = resolveRuntimePaths()
  const logger = options.logger ?? createLogger(paths.logPath)
  const openBrowser = options.openBrowser ?? true
  const shutdownToken = randomUUID()

  ensureDirectory(paths.dataDir)
  ensureDirectory(paths.logDir)
  ensureDirectory(paths.frontendDistDir)

  // Probe for existing RTWiki instance before binding the port.
  const existing = await probeExistingInstance(port, logger)
  if (existing) {
    // Another RTWiki is already running. Open its browser and exit cleanly.
    if (openBrowser) {
      const launcher = options.launcher ?? launchBrowser
      try {
        await launcher(existing.url)
      } catch (err) {
        logger.error('Browser-open failure', {
          event: 'single_instance',
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
    // Return a minimal runtime so the caller can exit without starting a second server.
    // We do NOT start a second database or HTTP server.
    const noopShutdown = async (): Promise<void> => {
      /* no-op: we did not start a server or database */
    }
    return {
      server: null as unknown as Awaited<ReturnType<typeof Bun.serve>>,
      logger,
      paths,
      db: null as unknown as Database,
      shutdownToken,
      shutdown: noopShutdown
    }
  }

  const writeTest = join(paths.dataDir, '.write-test')
  try {
    await Bun.write(writeTest, 'test')
    rmSync(writeTest, { force: true })
  } catch {
    logger.error('Data directory is not writable', { event: 'startup', action: 'abort' })
    throw new Error('RTWiki data directory is not writable')
  }

  const db = initDatabase(paths.dataDir)
  await runMigrations(db)
  if (!checkIntegrity()) {
    logger.error('Database failed integrity check', { event: 'startup', action: 'abort' })
    await closeDatabase()
    throw new Error('Database integrity check failed')
  }

  // Binds loopback only (127.0.0.1) — never exposed to the network.
  const server = await Bun.serve({
    fetch: app.fetch,
    port,
    hostname: '127.0.0.1'
  })

  logger.info('HTTP server listening', { event: 'startup', host: '127.0.0.1', port })

  let shuttingDown = false
  const doShutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('Shutting down', { event: 'shutdown' })
    try {
      server.stop()
    } catch {
      // Server may already be stopped.
    }
    await closeDatabase()
    await logger.close()
  }

  // Register this instance's shutdown token and handler. The routes are
  // already mounted on the app; this updates the module-level state they reference.
  setShutdownHandler(shutdownToken, () => doShutdown())

  if (openBrowser) {
    const launcher = options.launcher ?? launchBrowser
    await launcher(`http://127.0.0.1:${port}/`)
  }

  return { server, logger, paths, db, shutdownToken, shutdown: doShutdown }
}

function ensureDirectory(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}
