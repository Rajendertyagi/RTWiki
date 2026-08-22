import { existsSync } from 'node:fs'
import {
  APP_NAME,
  APP_VERSION,
  ATTACHMENTS_DIR,
  BACKUPS_DIR,
  DATABASE_FILENAME,
  DEFAULT_HOST,
  DEFAULT_PORT,
  LOGS_DIR,
  LOG_FILENAME,
  MAX_REQUEST_SIZE
} from '@rtwiki/shared/constants'

export interface AppConfig {
  name: string
  version: string
  host: string
  port: number
  apiPrefix: string
  healthPath: string
  frontendDistDir: string
  dataDir: string
  databaseFilename: string
  attachmentDir: string
  backupDir: string
  logDir: string
  logFilename: string
  maxRequestSize: number
}

export interface CreateConfigOverrides {
  host?: string
  port?: number
}

export function createConfig(baseDir: string, overrides: CreateConfigOverrides = {}): AppConfig {
  return {
    name: APP_NAME,
    version: APP_VERSION,
    host: overrides.host ?? DEFAULT_HOST,
    port: overrides.port ?? DEFAULT_PORT,
    apiPrefix: '/api',
    healthPath: '/health',
    frontendDistDir: joinPaths(baseDir, 'dist', 'web'),
    dataDir: joinPaths(baseDir, 'data'),
    databaseFilename: DATABASE_FILENAME,
    attachmentDir: ATTACHMENTS_DIR,
    backupDir: BACKUPS_DIR,
    logDir: joinPaths(baseDir, LOGS_DIR),
    logFilename: LOG_FILENAME,
    maxRequestSize: MAX_REQUEST_SIZE
  }
}

export interface RuntimePaths {
  exeDir: string
  /** True when running as the compiled portable executable. */
  compiled: boolean
  dataDir: string
  databasePath: string
  attachmentsDir: string
  backupsDir: string
  logDir: string
  logPath: string
  frontendDistDir: string
}

/**
 * Resolves the executable directory for portable storage.
 *
 * In compiled mode (RTWiki.exe), derives all paths from the executable's directory.
 * In development mode (bun run), derives paths from the repository root so runtime
 * data lives in <repo>/data and <repo>/logs instead of inside the source tree.
 * Never derives from process.cwd().
 */
export function resolveRuntimePaths(): RuntimePaths {
  const { baseDir: exeDir, compiled } = getRuntimeBase()

  // Frontend asset directory.
  // - Compiled: RTWiki.exe lives in <app>/dist and Vite emits the SPA to
  //   <app>/dist/web, so the assets are a direct sibling of the executable.
  // - Development: the build output is <repo>/build/web (vite.config.ts outDir).
  const frontendDistDir = compiled
    ? joinPaths(exeDir, 'web')
    : joinPaths(findProjectRoot(exeDir), 'build', 'web')

  return {
    exeDir,
    compiled,
    dataDir: joinPaths(exeDir, 'data'),
    databasePath: joinPaths(exeDir, 'data', DATABASE_FILENAME),
    attachmentsDir: joinPaths(exeDir, 'data', ATTACHMENTS_DIR),
    backupsDir: joinPaths(exeDir, 'data', BACKUPS_DIR),
    logDir: joinPaths(exeDir, LOGS_DIR),
    logPath: joinPaths(exeDir, LOGS_DIR, LOG_FILENAME),
    frontendDistDir
  }
}

/**
 * Returns the base directory and whether RTWiki is running as a compiled
 * executable.
 * - Compiled: directory containing RTWiki.exe (from process.execPath)
 * - Development: repository root (from import.meta)
 */
function getRuntimeBase(): { baseDir: string; compiled: boolean } {
  // Compiled executable: process.execPath points to RTWiki.exe
  if (typeof process !== 'undefined' && process.execPath) {
    const exePath = process.execPath
    const baseName = exePath.split(/[/\\]/).pop()
    if (baseName === 'RTWiki.exe' || baseName === 'RTWiki') {
      return { baseDir: dirname(exePath), compiled: true }
    }
  }

  // Development: use import.meta.dirname (Bun/Node ESM). This is the directory
  // of this config module (<repo>/src/server/config); walk up to the repository
  // root so runtime data stays beside the project, not inside the source tree.
  if (typeof import.meta !== 'undefined' && 'dirname' in import.meta) {
    const moduleDir = (import.meta as unknown as { dirname: string }).dirname
    return {
      baseDir: findProjectRoot(moduleDir),
      compiled: false
    }
  }

  // Fallback: should not reach here in normal operation
  throw new Error(
    'RTWiki: could not determine base directory. ' +
      'Run from the application directory, not from elsewhere.'
  )
}

/**
 * Walks up from `start` to locate the repository root (the directory that
 * contains package.json). Used in development to map the module location back
 * to the project root so runtime data and the Vite build output resolve to
 * stable repository-level locations.
 */
function findProjectRoot(start: string): string {
  let dir = start
  while (true) {
    if (existsSync(joinPaths(dir, 'package.json'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return start
}

export function joinPaths(...parts: string[]): string {
  return parts.join('/').replace(/\\/g, '/')
}

export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : '.'
}
