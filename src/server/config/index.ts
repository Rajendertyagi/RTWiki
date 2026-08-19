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

export function createConfig(
  baseDir: string,
  overrides: CreateConfigOverrides = {},
): AppConfig {
  return {
    name: "RTWiki",
    version: "0.1.0",
    host: overrides.host ?? "127.0.0.1",
    port: overrides.port ?? 8080,
    apiPrefix: "/api",
    healthPath: "/health",
    frontendDistDir: joinPaths(baseDir, "dist", "web"),
    dataDir: joinPaths(baseDir, "data"),
    databaseFilename: "rtwiki.sqlite",
    attachmentDir: "attachments",
    backupDir: "backups",
    logDir: joinPaths(baseDir, "logs"),
    logFilename: "rtwiki.log",
    maxRequestSize: 100 * 1024 * 1024,
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
  const exeDir = getBaseDirectory()

  return {
    exeDir,
    dataDir: joinPaths(exeDir, "data"),
    databasePath: joinPaths(exeDir, "data", "rtwiki.sqlite"),
    attachmentsDir: joinPaths(exeDir, "data", "attachments"),
    backupsDir: joinPaths(exeDir, "data", "backups"),
    logDir: joinPaths(exeDir, "logs"),
    logPath: joinPaths(exeDir, "logs", "rtwiki.log"),
    frontendDistDir: joinPaths(exeDir, "dist", "web"),
  }
}

/**
 * Returns the base directory for runtime paths.
 * - Compiled: directory containing RTWiki.exe (from process.execPath)
 * - Development: directory of the entry module (from import.meta)
 */
function getBaseDirectory(): string {
  // Compiled executable: process.execPath points to RTWiki.exe
  if (typeof process !== "undefined" && process.execPath) {
    const exePath = process.execPath
    const baseName = exePath.split(/[/\\]/).pop()
    if (baseName === "RTWiki.exe" || baseName === "RTWiki") {
      return dirname(exePath)
    }
  }

  // Development: use import.meta.dirname (Bun/Node ESM)
  // This gives the directory of the module that calls this function
  if (typeof import.meta !== "undefined" && "dirname" in import.meta) {
    return (import.meta as { dirname: string }).dirname
  }

  // Fallback: should not reach here in normal operation
  throw new Error(
    "RTWiki: could not determine base directory. " +
      "Run from the application directory, not from elsewhere.",
  )
}

export function joinPaths(...parts: string[]): string {
  return parts.join("/").replace(/\\/g, "/")
}

export function dirname(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return lastSlash >= 0 ? path.slice(0, lastSlash) : "."
}
