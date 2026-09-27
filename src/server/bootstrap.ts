import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import {
  APP_VERSION,
  ATTACHMENTS_DIR,
  DEBUG_LOG_FILENAME,
  DEBUG_LOG_MAX_BYTES,
  DEBUG_LOG_MAX_ROTATED_FILES
} from '@rtwiki/shared/constants'
import { createApp } from './app.js'
import { joinPaths, type RuntimePaths, resolveRuntimePaths } from './config/index.js'
import {
  checkIntegrity,
  closeDatabase,
  type Database,
  initDatabase,
  setDatabaseLogger
} from './database/index.js'
import { runMigrations } from './database/migrations.js'
import { type Launcher, launchBrowser } from './launcher.js'
import { createLogger, type Logger } from './logging/index.js'
import { RotatingJsonlSink } from './logging/rotating-sink.js'
import { sanitizePathForLog } from './logging/sanitize-path.js'
import { readServerPort } from './settings/index.js'
import { ShutdownCoordinator } from './shutdown-coordinator.js'

export interface BootstrapOptions {
  logger?: Logger
  launcher?: Launcher
  openBrowser?: boolean
  /** Listening port. Defaults to 8080; tests may pass 0 for auto-assignment. */
  port?: number
  /**
   * Overrides the log file location. Tests must inject a temporary path so
   * they never write to production or development runtime directories.
   */
  logPath?: string
  /**
   * Overrides the data directory (database, attachments, backups). Tests must
   * inject a temporary path so they never write to production/dev locations.
   */
  dataDir?: string
}

export interface Runtime {
  server: Awaited<ReturnType<typeof Bun.serve>>
  logger: Logger
  paths: RuntimePaths
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
 * Explains a directory RTWiki cannot use, in words a user can act on.
 *
 * The failure this replaces was a bare `EACCES: permission denied, mkdir '...'`
 * thrown out of `mkdirSync` before the logger existed. It named no folder in
 * RTWiki's own terms, offered no remedy, and — because a protected folder
 * usually protects its log directory too — could not be written down either.
 *
 * Exported and kept free of side effects so the exact words a user reads can be
 * asserted directly. A real EACCES cannot be produced in a test without changing
 * a directory ACL, which needs elevation; the branch is therefore covered by
 * this builder plus a real (privilege-free) failure through the same catch.
 */
export function unusableDirectoryMessage(dir: string, cause?: unknown): string {
  const lines: string[] = ['RTWiki could not use this folder to store your notes:', `  ${dir}`]
  const reported = errorCodeOf(cause)
  if (reported !== null) {
    lines.push(`  Windows reported: ${reported}`)
  }
  lines.push(
    '',
    'To fix this:',
    '  1. Move the RTWiki folder somewhere you have write access, such as your',
    '     Documents folder, then start RTWiki again.',
    '  2. Or give your user permission to write there: right-click the folder,',
    '     choose Properties, clear Read-only, and tick "Allow access" for you.',
    '  3. Installing into Program Files, or antivirus or corporate security',
    '     software, is the usual cause. RTWiki keeps its data beside the program',
    '     and will not store it anywhere else.',
    '',
    'RTWiki has stopped.'
  )
  return lines.join('\n')
}

/**
 * The OS error code, or the message when there is no code.
 *
 * Node's errno (`EACCES`, `EPERM`, `ENOSPC`, `ENOTDIR`) is the part a user can
 * look up; the full message restates the path that is already named above it.
 */
function errorCodeOf(cause: unknown): string | null {
  if (cause === undefined || cause === null) return null
  if (typeof cause === 'string') return cause
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code
    return typeof code === 'string' ? code : cause.message
  }
  return String(cause)
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
 *  1. Resolve runtime paths and create every runtime directory.
 *  2. Create the file logger (eagerly creates logs/rtwiki.log) and install it
 *     as the database module's logger.
 *  3. Create a fresh Hono app with the coordinator injected.
 *  4. Call Bun.serve() to start the server.
 *  5. Synchronously attach the real server handle before returning.
 *     No request can arrive between steps 4 and 5 because JavaScript
 *     cannot process another event while the current synchronous call
 *     stack is still executing.
 */
export async function bootstrap(options: BootstrapOptions = {}): Promise<Runtime> {
  const paths = resolveRuntimePaths()

  // Effective data directory (tests may inject a temporary location).
  const dataDir = options.dataDir ?? paths.dataDir

  // Listening port priority: explicit option (CLI --port, tests) beats the
  // persisted data/server.json value, which beats the compiled default.
  const port = options.port ?? readServerPort(dataDir)
  let boundPort = port
  const attachmentsDir = joinPaths(dataDir, ATTACHMENTS_DIR)
  const backupsDir = joinPaths(dataDir, 'backups')

  // ADR-005 portable layout plus one legacy directory: `attachments/` is where a
  // database created before ADR-014 still keeps its image files, and the
  // migration reads from it. It is no longer written to.
  ensureRuntimeDirectory(dataDir)
  ensureRuntimeDirectory(attachmentsDir)
  ensureRuntimeDirectory(backupsDir)
  ensureRuntimeDirectory(paths.logDir)
  ensureRuntimeDirectory(paths.frontendDistDir)

  // The logger constructor eagerly creates <logDir>/rtwiki.log, so it must be
  // constructed only after the directory exists.
  const logger = options.logger ?? createLogger(options.logPath ?? paths.logPath)
  setDatabaseLogger(logger)

  // Opt-in client debug log (Debug Mode): logs/rtwiki-debug.jsonl beside the
  // main log, with its own bounded rotation. Created eagerly so enabling the
  // toggle never has to create files mid-session.
  const debugLogPath = joinPaths(
    options.logPath ? options.logPath.replace(/[/\\][^/\\]+$/, '') : paths.logDir,
    DEBUG_LOG_FILENAME
  )
  const debugSink = new RotatingJsonlSink(debugLogPath, {
    maxBytes: DEBUG_LOG_MAX_BYTES,
    maxRotatedFiles: DEBUG_LOG_MAX_ROTATED_FILES
  })
  const debugEventSink = {
    append: (event: Record<string, unknown>): void => {
      debugSink.appendLine(JSON.stringify(event))
    }
  }

  const openBrowser = options.openBrowser ?? true
  const shutdownToken = randomUUID()

  // Privacy-redacted runtime directories: the Windows username never appears.
  const redaction = { repoRoot: paths.compiled ? undefined : paths.exeDir, exeDir: paths.exeDir }
  const effectiveLogDir = options.logPath
    ? options.logPath.replace(/[/\\][^/\\]+$/, '')
    : paths.logDir
  logger.info('RTWiki starting', {
    event: 'startup',
    version: APP_VERSION,
    dataDir: sanitizePathForLog(dataDir, redaction),
    logDir: sanitizePathForLog(effectiveLogDir, redaction),
    webDir: sanitizePathForLog(paths.frontendDistDir, redaction)
  })

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
    logger.info('Exiting: existing RTWiki instance already running', {
      event: 'single_instance'
    })
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

  const writeTest = joinPaths(dataDir, '.write-test')
  try {
    await Bun.write(writeTest, 'test')
    rmSync(writeTest, { force: true })
  } catch (err) {
    logger.error('Data directory is not writable', { event: 'startup', action: 'abort' })
    // The directory exists but cannot be written to, which is the case the
    // mkdir above cannot catch. Same words, same remedy: the user is told which
    // folder and what to do about it rather than being handed an errno.
    throw new Error(unusableDirectoryMessage(dataDir, err))
  }

  const db = initDatabase(dataDir)
  // The attachments directory is still created and still passed in: images moved
  // into the database (ADR-014), but a database created before that change still
  // has its bytes in files there, and the migration has to be able to find them.
  await runMigrations(db, attachmentsDir)
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
    frontendDistDir: paths.frontendDistDir,
    dataDir,
    getCurrentPort: () => boundPort,
    debugEventSink
  })

  // 3. Start the Bun HTTP server.
  const server = await Bun.serve({
    fetch: app.fetch,
    port,
    hostname: '127.0.0.1'
  })
  boundPort = server.port ?? port

  // 4. Synchronously attach the real server handle.
  //    No request can arrive between Bun.serve() resolving and this assignment
  //    because JavaScript cannot process another event while the current
  //    synchronous call stack is still executing.
  serverRef = server

  logger.info('HTTP server listening', { event: 'startup', host: '127.0.0.1', port: server.port })

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

/**
 * Creates a runtime directory if it is missing, or explains why it cannot.
 *
 * Every one of these directories lives beside the executable (ADR-005), so a
 * failure here is always the same user problem with the same remedy: the folder
 * RTWiki was installed into cannot be written to. It must not fall back to
 * another location, so this throws and startup stops.
 *
 * The error is raised here, before the logger exists, so the message has to be
 * complete on its own — the fatal reporter can only write it down if the log
 * directory is also usable, and often it is not.
 */
function ensureRuntimeDirectory(dir: string): void {
  if (existsSync(dir)) return
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    throw new Error(unusableDirectoryMessage(dir, err))
  }
}
