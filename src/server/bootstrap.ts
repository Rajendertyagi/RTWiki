import { app } from './app.js'
import { resolveRuntimePaths } from './config/index.js'
import { createLogger, type Logger } from './logging/index.js'
import { initDatabase, closeDatabase, checkIntegrity, type Database } from './database/index.js'
import { runMigrations } from './database/migrations.js'
import { launchBrowser, type Launcher } from './launcher.js'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

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
  shutdown: () => Promise<void>
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

  ensureDirectory(paths.dataDir)
  ensureDirectory(paths.logDir)
  ensureDirectory(join(paths.exeDir, 'dist', 'web'))

  const writeTest = join(paths.dataDir, '.write-test')
  try {
    await Bun.write(writeTest, 'test')
    await Bun.delete(writeTest)
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
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('Shutting down', { event: 'shutdown' })
    try {
      server.stop()
    } catch {
      // Server may already be stopped.
    }
    await closeDatabase()
    logger.info('Shutdown complete', { event: 'shutdown', done: true })
  }

  if (openBrowser) {
    const launcher = options.launcher ?? launchBrowser
    await launcher(`http://127.0.0.1:${port}/`)
  }

  return { server, logger, paths, db, shutdown }
}

function ensureDirectory(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}
