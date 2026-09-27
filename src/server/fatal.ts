import { resolveRuntimePaths } from './config/index.js'
import { createLogger } from './logging/index.js'

/**
 * Reports a fatal startup failure, on the terminal first and in the log second.
 *
 * The terminal report comes first because the most common fatal startup failure
 * is a folder that cannot be written to — and when that folder also holds
 * `logs/`, the log write is exactly what fails. A diagnostic that exists only
 * inside the log file is therefore a diagnostic nobody reads, which is how this
 * used to lose the one message that mattered.
 *
 * Plain sentences go to stderr; the log keeps its one machine-readable JSONL
 * line for anything reading the file programmatically. `index.ts` sets a
 * non-zero exit code afterwards, so the process still stops and never falls
 * back to another data directory.
 *
 * Lives in its own module so tests can exercise it without importing the
 * server entrypoint (which starts the application on import).
 * Tests inject a temporary logPath so they never touch real runtime paths.
 */
export async function reportFatalStartupError(
  error: unknown,
  logPath: string = resolveRuntimePaths().logPath
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)

  // eslint-disable-next-line no-console
  console.error(['', '*** RTWiki could not start. ***', '', message, ''].join('\n'))

  const logger = createLogger(logPath)
  logger.error('Fatal startup failure', {
    event: 'startup_fatal',
    error: message
  })
  await logger.close()
}
