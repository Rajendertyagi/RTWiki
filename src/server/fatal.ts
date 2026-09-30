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

  await waitForTheUserToReadIt()
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
 * Honest limit: this makes the message **readable**, not actionable. A GUI dialog
 * would need `bun:ffi` → `MessageBoxW`, and Bun's own documentation calls
 * `bun:ffi` experimental and advises against it in production — and whether
 * `dlopen` survives `bun build --compile` is unestablished here. A window-subsystem
 * build is not the answer either: it would remove the console from *normal*
 * operation, which is the diagnostic surface this whole module exists to use.
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
