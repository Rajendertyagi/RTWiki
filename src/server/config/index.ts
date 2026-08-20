import { existsSync } from 'node:fs'

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
    name: 'RTWiki',
    version: '0.1.0',
    host: overrides.host ?? '127.0.0.1',
    port: overrides.port ?? 8080,
    apiPrefix: '/api',
    healthPath: '/health',
    frontendDistDir: joinPaths(baseDir, 'dist', 'web'),
    dataDir: joinPaths(baseDir, 'data'),
    databaseFilename: 'rtwiki.sqlite',
    attachmentDir: 'attachments',
    backupDir: 'backups',
    logDir: joinPaths(baseDir, 'logs'),
    logFilename: 'rtwiki.log',
    maxRequestSize: 100 * 1024 * 1024
  }
}

export interface RuntimePaths {
  exeDir: string
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
 * In development mode (bun run), derives paths from import.meta.dirname (source root).
 * Never derives from process.cwd().
 */
export function resolveRuntimePaths(): RuntimePaths {
  const { baseDir: exeDir, compiled } = getRuntimeBase()

  // Frontend asset directory.
  // - Compiled: RTWiki.exe lives in <app>/dist and Vite emits the SPA to
  //   <app>/dist/web, so the assets are a direct sibling of the executable.
  // - Development: the module sits under <repo>/src/server/config and the build
  //   output is <repo>/dist/web.
  const frontendDistDir = compiled
    ? joinPaths(exeDir, 'web')
    : joinPaths(findProjectRoot(exeDir), 'dist', 'web')

  return {
    exeDir,
    dataDir: joinPaths(exeDir, 'data'),
    databasePath: joinPaths(exeDir, 'data', 'rtwiki.sqlite'),
    attachmentsDir: joinPaths(exeDir, 'data', 'attachments'),
    backupsDir: joinPaths(exeDir, 'data', 'backups'),
    logDir: joinPaths(exeDir, 'logs'),
    logPath: joinPaths(exeDir, 'logs', 'rtwiki.log'),
    frontendDistDir
  }
}

/**
 * Returns the base directory and whether RTWiki is running as a compiled
 * executable.
 * - Compiled: directory containing RTWiki.exe (from process.execPath)
 * - Development: directory of the entry module (from import.meta)
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

  // Development: use import.meta.dirname (Bun/Node ESM)
  // This gives the directory of the module that calls this function
  if (typeof import.meta !== 'undefined' && 'dirname' in import.meta) {
    return {
      baseDir: (import.meta as unknown as { dirname: string }).dirname,
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
 * to the project root so the Vite build output (<root>/dist/web) can be found.
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
