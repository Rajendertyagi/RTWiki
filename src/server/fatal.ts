import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, joinPaths, resolveRuntimePaths } from './config/index.js'
import { createLogger } from './logging/index.js'

/** Name of the findable error file written when the console is hidden. */
const STARTUP_ERROR_FILENAME = 'STARTUP-ERROR.txt'

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

  // With `hideConsole: true` the compiled executable has no console, so stderr
  // is not a surface a double-clicked executable can read. Write a plain-text
  // error file beside it (and in logs/) so the failure is findable, never silent.
  // Dev runs keep a console, so they do not need the artifact.
  if (resolveRuntimePaths().compiled) {
    writeStartupErrorFile(message, logPath)
  }

  await waitForTheUserToReadIt()
}

/**
 * Writes a human-readable startup error file. Best effort: a protected folder
 * may refuse the write, but the log line above has already been attempted and
 * the terminal message (where one exists) has been printed.
 */
function writeStartupErrorFile(message: string, logPath: string): void {
  const paths = resolveRuntimePaths()
  const body = [
    'RTWiki could not start.',
    '',
    message,
    '',
    'The detailed log is in logs/rtwiki.log beside RTWiki.exe.',
    'Fix the problem above, then start RTWiki again.'
  ].join('\n')
  const targets = [joinPaths(paths.exeDir, STARTUP_ERROR_FILENAME)]
  const logDir = dirname(logPath)
  if (logDir !== paths.exeDir) targets.push(joinPaths(logDir, STARTUP_ERROR_FILENAME))
  for (const target of targets) {
    try {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, body, 'utf8')
    } catch {
      // non-fatal: this is a best-effort diagnostic surface
    }
  }
}

/**
 * Holds the process open so the message above is still on screen when it exits.
 *
 * The compiled executable is a console-subsystem image, so a double-clicked
 * `RTWiki.exe` gets a console window that appears and closes as the process exits.
 * The message was written to stderr — which is bound to exactly that closing
 * window — and then the process ended, so the one diagnostic a user who cannot
 * write to `Program Files` most needed was gone before it could be read.
 *
 * Only when stdin is a TTY. A script, a service, or CI has no console to hold
 * open, and waiting there would hang the job rather than report anything. The
 * condition is the opposite way round from what it first looks like: the wait is
 * for the *interactive* case.
 *
 * The compiled executable is a window-subsystem (GUI) image, so there is no
 * console to hold open. `writeStartupErrorFile()` above is the durable surface:
 * a plain-text `STARTUP-ERROR.txt` is written beside the executable and in logs/.
 * The TTY wait below is kept for development runs, where a console does exist.
 */
async function waitForTheUserToReadIt(): Promise<void> {
  if (!process.stdin.isTTY) return
  // Resuming stdin is what keeps a compiled Bun process alive; without it the
  // runtime can exit while the console is still on screen.
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  const onKey = (): void => {
    cleanup()
    resolve()
  }
  const cleanup = (): void => {
    process.stdin.off('data', onKey)
    process.stdin.pause()
  }
  let resolve: () => void = () => undefined
  const done = new Promise<void>((res) => {
    resolve = res
  })
  process.stdin.on('data', onKey)
  await done
}
