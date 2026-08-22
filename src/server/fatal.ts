import { resolveRuntimePaths } from './config/index.js'
import { createLogger } from './logging/index.js'

/**
 * Persists a fatal startup failure to logs/rtwiki.log. Safe to call when the
 * failure happened before any directory existed: the file logger constructor
 * creates the directory and file, and degrades gracefully if that is impossible.
 *
 * Lives in its own module so tests can exercise it without importing the
 * server entrypoint (which starts the application on import).
 * Tests inject a temporary logPath so they never touch real runtime paths.
 */
export async function reportFatalStartupError(
  error: unknown,
  logPath: string = resolveRuntimePaths().logPath
): Promise<void> {
  const logger = createLogger(logPath)
  logger.error('Fatal startup failure', {
    event: 'startup_fatal',
    error: error instanceof Error ? error.message : String(error)
  })
  await logger.close()
}
