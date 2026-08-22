import { CLIENT_ERRORS_PATH } from '@rtwiki/shared/constants'
import type { ClientErrorReport } from '@rtwiki/shared/schemas/client-error'

type SafeEvent = ClientErrorReport['event']
type SafePageType = ClientErrorReport['pageType']

export interface ReportDetails {
  pageType?: SafePageType
  component?: string
  error?: unknown
}

interface DedupeEntry {
  count: number
  firstId: string
}

/**
 * Bounded dedupe: at most MAX_REPORTS_PER_KEY reports per event/component key,
 * and at most MAX_TRACKED_KEYS tracked keys (oldest evicted). The first
 * correlation ID for a key is reused for suppressed repeats so the UI never
 * shows a reference that is absent from the log.
 */
const MAX_REPORTS_PER_KEY = 3
const MAX_TRACKED_KEYS = 50

const reported = new Map<string, DedupeEntry>()

/**
 * Errors already caught by an inner boundary are marked here so the global
 * window.error / unhandledrejection listeners do not report them again.
 * A WeakMap lets error objects be garbage-collected, so nothing is retained.
 */
const handledErrors = new WeakMap<object, true>()

/** Canned, content-free messages. Real error messages can embed page content,
 * so they are never transmitted — only the error *name* (e.g. "TypeError"). */
const CANNED_MESSAGES: Record<SafeEvent, string> = {
  react_error_boundary: 'A component failed while rendering.',
  window_error: 'An unexpected browser error occurred.',
  unhandled_rejection: 'A promise rejected without a handler.',
  rich_note_parse_error: 'Stored Rich Note content could not be parsed.',
  rich_note_save_error: 'Saving the Rich Note failed.',
  rich_note_init_error: 'Initializing the Rich Note editor failed.'
}

function randomId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  let id = ''
  for (const byte of bytes) {
    id += byte.toString(16).padStart(2, '0')
  }
  return id
}

function sanitizeToken(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined
  const cleaned = value.replace(/[\x00-\x1F\x7F]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, max) : undefined
}

function errorName(error: unknown): string | undefined {
  if (error instanceof Error) return sanitizeToken(error.name, 120)
  if (error && typeof error === 'object' && 'name' in error) {
    const name = String((error as { name: unknown }).name)
    return sanitizeToken(name, 120)
  }
  return undefined
}

/**
 * Reduces an error stack to the top frame's basename and line/column, e.g.
 * "rich-editor.js:42:15". Paths, query strings and everything above the first
 * frame are dropped.
 */
function topStackLocation(error: unknown): string | undefined {
  const stack = (error as { stack?: unknown } | null)?.stack
  if (typeof stack !== 'string') return undefined
  for (const rawLine of stack.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('at ')) continue
    const frame = line.replace(/^at\s+/, '').replace(/\)$/, '')
    const segment = frame.split(/[\\/]/).pop() ?? frame
    return sanitizeToken(segment.split('?')[0], 200)
  }
  return undefined
}

async function post(report: ClientErrorReport): Promise<void> {
  try {
    await fetch(CLIENT_ERRORS_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true
    })
  } catch {
    // Reporting must never disturb the application.
  }
}

/**
 * Reports a sanitized frontend failure to the local diagnostics endpoint.
 * Returns the short diagnostic reference ID shown in recovery UIs; repeated
 * failures of the same kind reuse the first ID and are not re-sent.
 */
export function reportClientError(event: SafeEvent, details: ReportDetails = {}): string {
  const key = `${event}|${details.component ?? ''}|${details.pageType ?? 'unknown'}`
  const existing = reported.get(key)
  if (existing) {
    existing.count += 1
    if (existing.count > MAX_REPORTS_PER_KEY) {
      return existing.firstId
    }
    void post(buildReport(event, details, existing.firstId))
    return existing.firstId
  }

  if (reported.size >= MAX_TRACKED_KEYS) {
    const oldest = reported.keys().next().value
    if (oldest !== undefined) reported.delete(oldest)
  }

  const id = randomId()
  reported.set(key, { count: 1, firstId: id })
  void post(buildReport(event, details, id))
  return id
}

function buildReport(event: SafeEvent, details: ReportDetails, id: string): ClientErrorReport {
  return {
    event,
    pageType: details.pageType ?? 'unknown',
    component: sanitizeToken(details.component, 100),
    errorName: errorName(details.error),
    errorMessage: CANNED_MESSAGES[event],
    stackLocation: topStackLocation(details.error),
    correlationId: id,
    clientTimestamp: new Date().toISOString()
  }
}

/** Marks an error as handled by an inner boundary (dedupes global handlers). */
export function markHandled(error: unknown): void {
  if (error && typeof error === 'object') {
    handledErrors.set(error as object, true)
  }
}

/** True when this exact error object was already reported by a boundary. */
export function isHandled(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  return handledErrors.has(error as object)
}

let globalHandlersInstalled = false

/**
 * Registers window.error and unhandledrejection reporting. Idempotent.
 * Errors already caught by an inner boundary are skipped via markHandled.
 */
export function installGlobalErrorReporting(): void {
  if (globalHandlersInstalled) return
  globalHandlersInstalled = true
  window.addEventListener('error', (event) => {
    const error = event.error
    // Resource-load failures arrive without an error object; ignore them.
    if (!error || isHandled(error)) return
    reportClientError('window_error', { component: 'window', error })
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = (event as PromiseRejectionEvent).reason
    if (isHandled(reason)) return
    reportClientError('unhandled_rejection', { component: 'promise', error: reason })
  })
}
