/**
 * Opens the local wiki in the OS default browser.
 *
 * Design guarantees (see task requirements):
 * - Only loopback URLs are ever opened (never a remote/hostile URL).
 * - Browsers are launched with argument arrays (no shell, no string interpolation).
 * - The opener is dependency-injected so it can be stubbed in tests and never
 *   fired inside tests or CI (callers pass `openBrowser: false` there).
 */

export type Launcher = (url: string) => Promise<void> | void

const LOOPBACK_PREFIXES = ['http://127.0.0.1:', 'http://localhost:']

function isLoopback(url: string): boolean {
  return LOOPBACK_PREFIXES.some((prefix) => url.startsWith(prefix))
}

function defaultOpen(url: string): void {
  // Argument arrays only; the OS shell is never invoked.
  if (process.platform === 'win32') {
    void Bun.spawn(['rundll32', 'url.dll,FileProtocolHandler', url])
  } else if (process.platform === 'darwin') {
    void Bun.spawn(['open', url])
  } else {
    void Bun.spawn(['xdg-open', url])
  }
}

export async function launchBrowser(url: string, open: Launcher = defaultOpen): Promise<void> {
  if (!isLoopback(url)) {
    throw new Error(`Refusing to open non-loopback URL: ${url}`)
  }
  try {
    await open(url)
  } catch (err) {
    // Re-throw with context so callers can log the browser-open failure.
    throw new Error(
      `Browser-open failure: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
