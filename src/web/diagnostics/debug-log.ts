import {
  CLIENT_DEBUG_EVENTS_PATH,
  CLIENT_DEBUG_MAX_EVENTS_PER_BATCH,
  DEBUG_LOG_FLUSH_INTERVAL_MS,
  DEBUG_LOG_MAX_CONSECUTIVE_FAILURES,
  DEBUG_LOG_MAX_QUEUE
} from '@rtwiki/shared/constants'
import type {
  DEBUG_EVENT_NAMES,
  DebugEventCategory,
  DebugEventName,
  DebugSourceField
} from '@rtwiki/shared/schemas/debug-events'

/**
 * Opt-in structured client debug logging (Debug Mode).
 *
 * Privacy contract, enforced by construction:
 * - `debugLog` accepts ONLY the allowlisted event names and the typed safe
 *   fields below. There is no parameter that could carry note content,
 *   source code, titles, DOM text, aria-labels, input values or arbitrary
 *   metadata. Callers pass IDs, view types, revisions/generations, lengths,
 *   a short non-reversible hash (`safeHash`), durations and result codes.
 * - The server schema re-validates everything and REJECTS unknown fields.
 *
 * Reliability contract:
 * - Disabled by default; the toggle persists locally.
 * - Events are batched and flushed on an interval; the queue is bounded and
 *   drops the oldest events when full.
 * - Every send failure is swallowed. After repeated consecutive failures the
 *   session stops sending until it is re-enabled. Logging can never break
 *   editing.
 */

/** Bounded, content-free fields attachable to any event. */
export interface DebugLogFields {
  /** Correlation/operation ID for grouping related events. */
  op?: string
  pageId?: string
  /** Target of an operation (e.g. drop/move destination). */
  targetId?: string
  tabId?: string
  field?: DebugSourceField
  rev?: number
  gen?: number
  len?: number
  hash?: string
  durMs?: number
  result?: 'ok' | 'error' | 'cancelled' | 'rejected' | 'stale' | 'skipped'
  /** Machine-readable error/action code token, never free text. */
  code?: string
}

interface QueuedEvent {
  ts: number
  cat: DebugEventCategory
  evt: DebugEventName
  fields: DebugLogFields
}

/** Minimal storage surface so tests can run without a browser. */
export interface DebugLogStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const STORAGE_KEY = 'rtwiki.debug-logging.enabled'

const memoryStorage = new Map<string, string>()

function defaultStorage(): DebugLogStorage {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
  } catch {
    // Storage access can throw (privacy settings); fall back to memory.
  }
  return {
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => void memoryStorage.set(key, value),
    removeItem: (key) => void memoryStorage.delete(key)
  }
}

let storage: DebugLogStorage = defaultStorage()

/** Overrides the persistence backing store (test injection point). */
export function setDebugLogStorageForTests(impl: DebugLogStorage): void {
  storage = impl
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let enabled = false
let sessionId: string | null = null
let queue: QueuedEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let consecutiveFailures = 0

function newSessionId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    // randomUUID is unavailable only in very old/non-secure contexts.
    return `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isDebugLoggingEnabled(): boolean {
  return enabled
}

/** Reads the persisted toggle without activating anything. */
export function readStoredDebugLoggingPreference(): boolean {
  return storage.getItem(STORAGE_KEY) === 'true'
}

/** Called once at application start: activates Debug Mode if persisted on. */
export function configureDebugLoggingFromStorage(): void {
  if (readStoredDebugLoggingPreference()) {
    activateSession()
  }
}

/**
 * Enables/disables Debug Mode and persists the choice. Enabling starts a new
 * debug session; disabling flushes what is queued and stops sending.
 */
export function setDebugLoggingEnabled(next: boolean): void {
  if (next === enabled) return
  if (next) {
    storage.setItem(STORAGE_KEY, 'true')
    activateSession()
  } else {
    storage.removeItem(STORAGE_KEY)
    void flushNow()
    deactivateSession()
  }
}

function activateSession(): void {
  enabled = true
  sessionId = newSessionId()
  consecutiveFailures = 0
  queue = []
}

function deactivateSession(): void {
  enabled = false
  sessionId = null
  queue = []
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}

/**
 * Records one allowlisted debug event. Type-level guarantee: the event name
 * must belong to the declared category. No-op when Debug Mode is off.
 */
export function debugLog<C extends DebugEventCategory>(
  category: C,
  event: DebugEventName & (typeof DEBUG_EVENT_NAMES)[C][number],
  fields: DebugLogFields = {}
): void {
  if (!enabled || sessionId === null) return
  queue.push({ ts: Date.now(), cat: category, evt: event, fields })
  if (queue.length > DEBUG_LOG_MAX_QUEUE) {
    // Drop oldest to keep memory bounded during event storms.
    queue.splice(0, queue.length - DEBUG_LOG_MAX_QUEUE)
  }
  if (queue.length >= 25) {
    void flushNow()
    return
  }
  if (flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flushNow()
    }, DEBUG_LOG_FLUSH_INTERVAL_MS)
  }
}

async function flushNow(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!enabled || sessionId === null || queue.length === 0) return
  // Send in server-sized chunks so a burst collected by the timer can never
  // exceed the ingestion batch cap (which would reject the whole batch).
  while (queue.length > 0 && enabled && consecutiveFailures < DEBUG_LOG_MAX_CONSECUTIVE_FAILURES) {
    const chunk = queue.splice(0, CLIENT_DEBUG_MAX_EVENTS_PER_BATCH)
    const body = JSON.stringify({
      session: sessionId,
      events: chunk.map((event) => ({
        ...event.fields,
        ts: event.ts,
        cat: event.cat,
        evt: event.evt
      }))
    })
    try {
      const response = await fetch(CLIENT_DEBUG_EVENTS_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true
      })
      if (!response.ok) {
        throw new Error(`debug ingest ${response.status}`)
      }
      consecutiveFailures = 0
    } catch {
      consecutiveFailures += 1
      if (consecutiveFailures >= DEBUG_LOG_MAX_CONSECUTIVE_FAILURES) {
        // Stop sending for this session; the toggle stays on so the next
        // enable/reload starts fresh. Never surfaces anywhere in the UI.
        deactivateSession()
        return
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers shared by instrumentation call sites
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit fingerprint as 8 hex chars. Non-reversible, bounded. */
export function safeHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Returns a wrapper that invokes `emit` at most once per `intervalMs` per
 * key, with a trailing call carrying the latest arguments. Used to keep
 * noisy streams (keystrokes, drag hovers) out of the log while preserving
 * the most recent state change.
 */
export function createThrottledEmitter<A extends unknown[]>(
  intervalMs: number,
  emit: (...args: A) => void
): (...args: A) => void {
  let lastEmittedAt = 0
  let trailingTimer: ReturnType<typeof setTimeout> | null = null
  let trailingArgs: A | null = null
  return (...args: A): void => {
    const now = Date.now()
    if (now - lastEmittedAt >= intervalMs) {
      lastEmittedAt = now
      emit(...args)
      return
    }
    trailingArgs = args
    if (trailingTimer === null) {
      trailingTimer = setTimeout(() => {
        trailingTimer = null
        if (trailingArgs !== null) {
          lastEmittedAt = Date.now()
          emit(...(trailingArgs as A))
          trailingArgs = null
        }
      }, intervalMs)
    }
  }
}

/** Resets all module state (test isolation only). */
export function __resetDebugLogForTests(): void {
  deactivateSession()
  storage.removeItem(STORAGE_KEY)
}
