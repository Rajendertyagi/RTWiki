import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createApp } from './app.js'
import { resolveRuntimePaths } from './config/index.js'
import { checkIntegrity, closeDatabase, type Database, initDatabase } from './database/index.js'
import { runMigrations } from './database/migrations.js'
import { type Launcher, launchBrowser } from './launcher.js'
import { createLogger, type Logger } from './logging/index.js'
import { ShutdownCoordinator } from './shutdown-coordinator.js'

export interface BootstrapOptions {
  logger?: Logger
  launcher?: Launcher
  openBrowser?: boolean
  /** Listening port. Defaults to 8080; tests may pass 0 for auto-assignment. */
  port?: number
}

export interface Runtime {
  server: Awaited<ReturnType<typeof Bun.serve>>
  logger: Logger
  paths: ReturnType<typeof resolveRuntimePaths>
  db: Database
  shutdownToken: string
  coordinator: ShutdownCoordinator
  /** Shorthand for coordinator.requestShutdown(). */
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
 * Composition root: owns the config, logger, database, HTTP server, and shutdown
 * coordinator singletons. Each call creates an isolated app and coordinator.
 *
 * Construction order (deterministic, no races):
 *  1. Create coordinator with late-bound server-stop capability.
 *  2. Create a fresh Hono app with the coordinator injected.
 *  3. Call Bun.serve() to start the server.
 *  4. Synchronously attach the real server handle before returning.
 *     No request can arrive between steps 3 and 4 because JavaScript
 *     cannot process another event while the current synchronous call
 *     stack is still executing.
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
    // Close the logger created for this second process — it has no server to serve.
    await logger.close()
    return {
      server: null as unknown as Awaited<ReturnType<typeof Bun.serve>>,
      logger,
      paths,
      db: null as unknown as Database,
      shutdownToken,
      coordinator: new ShutdownCoordinator({
        stopGracefully: async () => {
          throw new Error('No server — existing instance detected')
        },
        closeDatabase: async () => {},
        logInfo: () => {},
        logWarn: () => {},
        logError: () => {},
        closeLogger: async () => {}
      }),
      shutdown: async () => {}
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

  // 1. Create coordinator with late-bound server-stop capability.
  let serverRef: Awaited<ReturnType<typeof Bun.serve>> | null = null
  const coordinator = new ShutdownCoordinator({
    stopGracefully: async () => {
      if (!serverRef) throw new Error('Server not yet attached')
      await serverRef.stop()
    },
    closeDatabase: async () => {
      await closeDatabase()
    },
    logInfo: logger.info.bind(logger),
    logWarn: logger.warn.bind(logger),
    logError: logger.error.bind(logger),
    closeLogger: logger.close.bind(logger)
  })

  // 2. Create a fresh Hono app with the coordinator injected.
  const app = createApp({
    coordinator,
    token: shutdownToken,
    getDb: () => db,
    logger,
    frontendDistDir: paths.frontendDistDir
  })

  // 3. Start the Bun HTTP server.
  const server = await Bun.serve({
    fetch: app.fetch,
    port,
    hostname: '127.0.0.1'
  })

  // 4. Synchronously attach the real server handle.
  //    No request can arrive between Bun.serve() resolving and this assignment
  //    because JavaScript cannot process another event while the current
  //    synchronous call stack is still executing.
  serverRef = server

  logger.info('HTTP server listening', { event: 'startup', host: '127.0.0.1', port: server.port })

  // DIAGNOSTIC: log frontend dist dir existence for debugging packaged-asset 404s.
  // Remove after root cause is confirmed fixed.
  const distExists = existsSync(paths.frontendDistDir)
  console.error(`[rtwiki-startup] frontendDistDir=${paths.frontendDistDir} exists=${distExists}`)

  if (openBrowser) {
    const launcher = options.launcher ?? launchBrowser
    await launcher(`http://127.0.0.1:${server.port}/`)
  }

  return {
    server,
    logger,
    paths,
    db,
    shutdownToken,
    coordinator,
    shutdown: async () => {
      await coordinator.requestShutdown()
    }
  }
}

function ensureDirectory(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}
