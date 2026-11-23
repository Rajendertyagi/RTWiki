import { Database as BunDatabase } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import {
  APP_VERSION,
  ATTACHMENTS_DIR,
  BACKUPS_DIR,
  CLEAN_EXIT_MARKER_FILENAME,
  DATABASE_FILENAME,
  DEBUG_LOG_FILENAME,
  DEBUG_LOG_MAX_BYTES,
  DEBUG_LOG_MAX_ROTATED_FILES,
  DEFAULT_PORT,
  SETTINGS_KEY_SERVER_PORT,
  SHUTDOWN_DRAIN_TIMEOUT_MS,
  SHUTDOWN_FULL_SAVE_TIMEOUT_MS
} from '@rtwiki/shared/constants'
import { createApp } from './app.js'
import { reclaimUnreferencedAttachments } from './attachments/attachment-retention.js'
import { sweepPartialBackups } from './backup/backup-service.js'
import { type BackupSchedule, startBackupSchedule } from './backup/schedule.js'
import { joinPaths, type RuntimePaths, resolveRuntimePaths } from './config/index.js'
import {
  checkIntegrity,
  closeDatabase,
  type Database,
  fullSaveToMainFile,
  getDb,
  initDatabase,
  setDatabaseLogger
} from './database/index.js'
import { runMigrations } from './database/migrations.js'
import { type Launcher, launchBrowser } from './launcher.js'
import { createLogger, type Logger } from './logging/index.js'
import { RotatingJsonlSink } from './logging/rotating-sink.js'
import { sanitizePathForLog } from './logging/sanitize-path.js'
import { readAllSettings } from './settings/index.js'
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
  /** Null when there is no data directory (the default test instance). */
  backupSchedule: BackupSchedule | null
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
 * Outcome of the running-copy probe. Logging is deliberately left to the caller
 * so the probe itself touches no files: it runs before any directory is created
 * and before the file logger exists.
 */
interface ExistingInstanceProbe {
  detected: boolean
  url?: string
  occupiedByOther: boolean
  status?: number
}

/**
 * Probes the port to detect whether an existing RTWiki instance is already running.
 * This is step 1 of bootstrap (startup sequence) and must run before any file or
 * directory is created. The only earlier file access is the read-only port probe
 * in `probePort()`, which is required to find a copy on a changed port.
 */
async function probeExistingInstance(port: number): Promise<ExistingInstanceProbe> {
  const url = `http://127.0.0.1:${port}/health`
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>
      if (body.app === 'RTWiki') {
        return { detected: true, url: `http://127.0.0.1:${port}/`, occupiedByOther: false }
      }
    }

    // Port is occupied by a different application (responded but not RTWiki).
    return { detected: false, occupiedByOther: true, status: res.status }
  } catch {
    // No response — port is free or connection refused. Proceed with startup.
    return { detected: false, occupiedByOther: false }
  }
}

/** Path of the clean-exit marker inside the data directory. */
function cleanExitMarkerPath(dataDir: string): string {
  return joinPaths(dataDir, CLEAN_EXIT_MARKER_FILENAME)
}

/** True when a previous run left the clean-exit marker behind. */
function previousRunWasUnclean(dataDir: string): boolean {
  return existsSync(cleanExitMarkerPath(dataDir))
}

/** Creates the clean-exit marker once all startup checks have passed. */
function createCleanExitMarker(dataDir: string): void {
  try {
    writeFileSync(cleanExitMarkerPath(dataDir), String(Date.now()), 'utf8')
  } catch {
    // A marker is a diagnostic, not a data file: never fail startup over it.
  }
}

/** Removes the clean-exit marker on a clean exit. */
function clearCleanExitMarker(dataDir: string): void {
  try {
    rmSync(cleanExitMarkerPath(dataDir), { force: true })
  } catch {
    // non-fatal
  }
}

/**
 * A clear, actionable message for a port already in use. It names the port and
 * the command-line override, because a Settings screen cannot help when the app
 * cannot start. It never auto-picks another port: that would put the shell and
 * the server out of sync.
 */
export function portInUseMessage(port: number): string {
  return [
    `Failed to start server: port ${port} is already in use.`,
    '',
    'To use a different port, start RTWiki with:',
    `  RTWiki.exe --port <other-port>`,
    '',
    'If another copy of RTWiki is already running, close it first.',
    '',
    'RTWiki has stopped.'
  ].join('\n')
}

/** A damaged database aborts startup with a message pointing at the backups. */
export function damagedDatabaseMessage(): string {
  return [
    'RTWiki could not read its database, so it stopped to protect your notes.',
    '',
    'Your backups are in the data/backups folder beside RTWiki.exe. You can',
    'restore the most recent backup from Settings once RTWiki is running again,',
    'or copy a backup over data/rtwiki.sqlite yourself.',
    '',
    'RTWiki has stopped.'
  ].join('\n')
}

/**
 * Reads the persisted port for the single-instance probe WITHOUT opening the
 * managed database or running migrations. A short-lived read-only connection is
 * enough; if the DB does not exist yet (first launch) or the row is missing or
 * invalid, the compiled default is used. The authoritative port is read later
 * from the managed connection after migrations.
 */
function probePort(dataDir: string, explicitPort?: number): number {
  if (explicitPort !== undefined) return explicitPort
  const path = joinPaths(dataDir, DATABASE_FILENAME)
  if (!existsSync(path)) return DEFAULT_PORT
  let conn: BunDatabase | null = null
  try {
    conn = new BunDatabase(path, { readonly: true })
    const row = conn
      .query('SELECT value FROM settings WHERE key = ?1')
      .get(SETTINGS_KEY_SERVER_PORT) as { value: string } | undefined
    if (row) {
      const parsed = JSON.parse(row.value) as unknown
      if (
        typeof parsed === 'number' &&
        Number.isInteger(parsed) &&
        parsed >= 1024 &&
        parsed <= 65535
      ) {
        return parsed
      }
    }
  } catch {
    // Missing table or corrupt value — the probe falls back to the default.
  } finally {
    conn?.close()
  }
  return DEFAULT_PORT
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
  const attachmentsDir = joinPaths(dataDir, ATTACHMENTS_DIR)
  const backupsDir = joinPaths(dataDir, BACKUPS_DIR)

  // ---------------------------------------------------------------------------
  // Step 1 — detect an already-running copy BEFORE touching any file or folder.
  // The one allowed exception is the short, read-only look at the database to
  // find the saved port: without it the check would miss a copy running on a
  // changed port. No directory is created and no write lock is acquired here.
  // ---------------------------------------------------------------------------
  const openBrowser = options.openBrowser ?? true
  const shutdownToken = randomUUID()
  const probePortValue = probePort(dataDir, options.port)
  const probe = await probeExistingInstance(probePortValue)

  if (probe.detected) {
    // Detection has already happened, so it is now safe to create the log
    // directory and record the event before exiting.
    ensureRuntimeDirectory(paths.logDir)
    const logger = options.logger ?? createLogger(options.logPath ?? paths.logPath)
    logger.info('Existing RTWiki instance detected', {
      event: 'single_instance',
      port: probePortValue,
      detected: true
    })
    if (openBrowser && probe.url) {
      const launcher = options.launcher ?? launchBrowser
      try {
        await launcher(probe.url)
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
    await closeDatabase()
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
        fullSave: () => ({ ok: true }),
        clearCleanExitMarker: () => {},
        closeDatabase: async () => {},
        logInfo: () => {},
        logWarn: () => {},
        logError: () => {},
        closeLogger: async () => {}
      }),
      backupSchedule: null,
      shutdown: async () => {}
    }
  }

  // ---------------------------------------------------------------------------
  // Steps 2+ — no running copy. From here on it is safe to create directories
  // and open the file logger. Every step logs its name so a failed start shows
  // exactly where it stopped.
  // ---------------------------------------------------------------------------
  ensureRuntimeDirectory(dataDir)
  ensureRuntimeDirectory(attachmentsDir)
  ensureRuntimeDirectory(backupsDir)
  ensureRuntimeDirectory(paths.logDir)
  ensureRuntimeDirectory(paths.frontendDistDir)

  const logger = options.logger ?? createLogger(options.logPath ?? paths.logPath)
  setDatabaseLogger(logger)
  const step = (name: string, detail: Record<string, unknown> = {}): void => {
    logger.info(`Bootstrap step: ${name}`, { event: 'bootstrap_step', step: name, ...detail })
  }

  // The crash marker is checked only after the running-copy check, so a second
  // copy never mistakes the first copy's marker for a crash. It is the first
  // line in the log when present.
  if (previousRunWasUnclean(dataDir)) {
    logger.warn('Previous run did not close cleanly', {
      event: 'startup_unclean_previous_run'
    })
    // Report it once, then clear it so later clean starts do not repeat the warning.
    clearCleanExitMarker(dataDir)
  }

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
  step('single_instance_check', { detected: false, port: probePortValue })
  if (probe.occupiedByOther) {
    logger.warn('Port occupied by a different application', {
      event: 'single_instance',
      port: probePortValue,
      detected: false,
      status: probe.status
    })
  }

  // Step 2 — check the data folder is writable, with a friendly message.
  step('data_directory_writable_check')
  const writeTest = joinPaths(dataDir, '.write-test')
  try {
    await Bun.write(writeTest, 'test')
    rmSync(writeTest, { force: true })
  } catch (err) {
    logger.error('Data directory is not writable', { event: 'startup', action: 'abort' })
    throw new Error(unusableDirectoryMessage(dataDir, err))
  }

  // Step 3 — open the database, run upgrades, run the integrity check. A damaged
  // database stops startup with a message pointing at the backups.
  step('database_open_migrate_integrity')
  let db: Database
  try {
    db = initDatabase(dataDir)
    // The attachments directory is still created and still passed in: images moved
    // into the database (ADR-014), but a database created before that change still
    // has its bytes in files there, and the migration has to be able to find them.
    await runMigrations(db, attachmentsDir)
    if (!checkIntegrity()) {
      throw new Error('integrity check failed')
    }
  } catch (err) {
    // A damaged database can fail at open, during a pragma, during migration or
    // at the integrity check. Every one of those is the same user problem, so
    // they all produce the same actionable message pointing at the backups.
    logger.error('Database could not be opened or verified', {
      event: 'startup',
      action: 'abort',
      detail: err instanceof Error ? err.message : String(err)
    })
    await closeDatabase()
    throw new Error(damagedDatabaseMessage())
  }

  // Step 4 — read settings in one explicit step. Each invalid setting resets
  // only itself, in memory; the stored row is left untouched.
  step('read_settings')
  const settings = readAllSettings(getDb)
  if (settings.resetKeys.length > 0) {
    logger.info('Invalid settings reset to their defaults', {
      event: 'startup',
      action: 'reset_settings',
      keys: settings.resetKeys
    })
  }

  // Step 5 — choose the port. Explicit CLI/test option beats the stored value,
  // which beats the compiled default. Port 0 is a test-only injection; the CLI
  // parser rejects it, so production never auto-picks a different port.
  step('choose_port')
  const port = options.port ?? settings.port
  let boundPort = port

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

  // Deletes backups a previous run left half-written. "Delete on failure" does
  // not cover a hard kill, and SQLite states an interrupted `VACUUM INTO` "might
  // be incomplete and corrupt" -- so without this a crashed run leaves a corrupt
  // file sitting where a backup belongs. Runs after migrations, which need the
  // write lock first.
  sweepPartialBackups(dataDir)

  // Reclaims attachments no document refers to. Runs once at
  // startup rather than on a timer: the leak only grows when a note is deleted, and
  // a startup pass costs one table scan, whereas a timer would keep re-scanning for
  // a condition that has not changed. The 30-day default means an image deleted
  // along with its note survives a month before anything touches it.
  //
  // Reported rather than thrown. A pass that cannot reclaim everything must not
  // stop the application from starting — the data is merely still there, which is
  // the same state as before this ran.
  try {
    const reclaimed = reclaimUnreferencedAttachments(db)
    if (reclaimed.reclaimed.length > 0 || reclaimed.failed.length > 0) {
      logger.info('Reclaimed unreferenced attachments', {
        event: 'startup',
        action: 'reclaim_attachments',
        reclaimed: reclaimed.reclaimed.length,
        bytes: reclaimed.bytes,
        failed: reclaimed.failed.length,
        tooYoung: reclaimed.tooYoung.length
      })
    }
    for (const failure of reclaimed.failed) {
      logger.warn('Could not reclaim an unreferenced attachment', {
        event: 'startup',
        action: 'reclaim_attachments',
        detail: failure.reason
      })
    }
  } catch (err) {
    logger.warn('Attachment reclaim pass failed', {
      event: 'startup',
      action: 'reclaim_attachments',
      detail: err instanceof Error ? err.message : String(err)
    })
  }

  // Create coordinator with late-bound server-stop capability.
  let serverRef: Awaited<ReturnType<typeof Bun.serve>> | null = null

  // The backup schedule. Started here rather than after the server binds so
  // that a long backup cannot begin before the runtime is ready, and stopped in
  // `stopGracefully` so a shutdown does not leave a timer holding the process
  // open. `startBackupSchedule` returns null when there is no data directory,
  // which is the default test instance -- it must never write to a real path.
  const backupSchedule = startBackupSchedule({
    dataDir,
    getDb: () => db,
    logger
  })

  const coordinator = new ShutdownCoordinator({
    stopGracefully: async () => {
      if (!serverRef) throw new Error('Server not yet attached')
      backupSchedule?.stop()
      const server = serverRef
      // Stop accepting new work, then wait a short bounded time for work in
      // progress. Never hang forever: force remaining connections closed when
      // the bound elapses.
      server.stop()
      const deadline = Date.now() + SHUTDOWN_DRAIN_TIMEOUT_MS
      while (server.pendingRequests > 0 && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 25))
      }
      if (server.pendingRequests > 0) {
        server.stop(true)
      }
    },
    fullSave: () => fullSaveToMainFile(SHUTDOWN_FULL_SAVE_TIMEOUT_MS),
    clearCleanExitMarker: () => clearCleanExitMarker(dataDir),
    closeDatabase: async () => {
      await closeDatabase()
    },
    logInfo: logger.info.bind(logger),
    logWarn: logger.warn.bind(logger),
    logError: logger.error.bind(logger),
    closeLogger: logger.close.bind(logger)
  })

  // The address the server actually binds. Named once and used in three places
  // -- the app's Host allowlist, `Bun.serve`, and the startup log -- because the
  // allowlist is only correct if it names the same address that is bound, and
  // three copies of that string is how they would drift apart.
  //
  // Hardcoded to loopback, which is the documented default. Authorising LAN
  // binding (ADR-001) means changing this ONE line to the configured host, and
  // nothing else: the Host allowlist in `request-host.ts` already accepts
  // whatever this is.
  const bindHost = '127.0.0.1'

  // Create a fresh Hono app with the coordinator injected.
  const app = createApp({
    coordinator,
    token: shutdownToken,
    getDb: () => db,
    logger,
    frontendDistDir: paths.frontendDistDir,
    themesDir: joinPaths(paths.frontendDistDir, 'themes'),
    dataDir,
    getCurrentPort: () => boundPort,
    debugEventSink,
    host: bindHost
  })

  // Step 6 — start the server. A busy port is reported clearly, naming the port
  // and the override; no different port is ever auto-picked.
  step('start_server', { port })
  let server: Awaited<ReturnType<typeof Bun.serve>>
  try {
    server = await Bun.serve({
      fetch: app.fetch,
      port,
      hostname: bindHost
    })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'EADDRINUSE' || String(err).includes('EADDRINUSE')) {
      logger.error('Port already in use', { event: 'startup', action: 'abort', port })
      throw new Error(portInUseMessage(port))
    }
    throw err
  }
  boundPort = server.port ?? port

  // Synchronously attach the real server handle.
  // No request can arrive between Bun.serve() resolving and this assignment
  // because JavaScript cannot process another event while the current
  // synchronous call stack is still executing.
  serverRef = server

  // All startup checks have passed: create the clean-exit marker now. On the
  // next start its presence (after the running-copy check) means this run did
  // not close cleanly.
  createCleanExitMarker(dataDir)
  step('server_healthy', { port: server.port })

  logger.info('HTTP server listening', { event: 'startup', host: bindHost, port: server.port })

  // Open the browser only after the server reports healthy.
  if (openBrowser) {
    const healthy = await waitForSelfHealthy(bindHost, server.port ?? port)
    if (!healthy) {
      logger.warn('Server did not report healthy before opening the browser', {
        event: 'startup',
        port: server.port
      })
    }
    const launcher = options.launcher ?? launchBrowser
    await launcher(`http://${bindHost}:${server.port}/`)
  }

  return {
    server,
    logger,
    paths,
    db,
    shutdownToken,
    coordinator,
    // Exposed so a test can run a due slot without waiting for the kickoff.
    backupSchedule,
    shutdown: async () => {
      await coordinator.requestShutdown()
    }
  }
}

/** Bounded wait for the freshly started server to answer /health. */
async function waitForSelfHealthy(host: string, port: number): Promise<boolean> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${host}:${port}/health`, {
        signal: AbortSignal.timeout(500)
      })
      if (res.ok) return true
    } catch {
      // not ready yet
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
  }
  return false
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
