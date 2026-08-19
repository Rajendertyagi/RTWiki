import { serve } from 'hono/node-server'
import { app } from './app.js'
import { resolveRuntimePaths } from './config/index.js'
import { createLogger, type Logger } from './logging/index.js'
import { initDatabase, closeDatabase } from './database/index.js'
import { runMigrations } from './database/migrations.js'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export interface BootstrapOptions {
  logger?: Logger
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<{
  server: Awaited<ReturnType<typeof serve>>
  logger: Logger
  paths: ReturnType<typeof resolveRuntimePaths>
  shutdown: () => Promise<void>
}> {
  const paths = resolveRuntimePaths()
  const loggerInstance = options.logger ?? createLogger(paths.logPath)

  // Create required directories
  ensureDirectory(paths.dataDir)
  ensureDirectory(paths.logDir)
  ensureDirectory(join(paths.exeDir, 'dist', 'web'))

  // Check writability
  const testFile = join(paths.dataDir, '.write-test')
  try {
    Bun.write(testFile, 'test')
    Bun.delete(testFile)
  } catch {
    loggerInstance.error(
      `RTWiki cannot write to its data folder at ${paths.dataDir}. Please move the RTWiki folder to a writable location such as Documents or Desktop, then try again.`
    )
    process.exit(1)
  }

  // Initialize database and run migrations
  const db = initDatabase(paths.dataDir)
  await runMigrations(db)

  // Start server
  const server = serve({
    fetch: app.fetch,
    port: 8080,
    hostname: '127.0.0.1'
  })

  loggerInstance.info('RTWiki v0.1.0 starting on http://127.0.0.1:8080')
  loggerInstance.info(`Data directory: ${paths.dataDir}`)
  loggerInstance.info(`Log file: ${paths.logPath}`)

  const shutdown = async (): Promise<void> => {
    loggerInstance.info('Shutting down...')
    await server.stop()
    await closeDatabase()
    loggerInstance.info('Shutdown complete')
  }

  return { server, logger: loggerInstance, paths, shutdown }
}

function ensureDirectory(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}
