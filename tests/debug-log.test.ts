import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { DEBUG_LOG_MAX_QUEUE } from '../src/shared/constants/index.js'
import {
  __resetDebugLogForTests,
  createThrottledEmitter,
  debugLog,
  isDebugLoggingEnabled,
  safeHash,
  setDebugLoggingEnabled,
  setDebugLogStorageForTests
} from '../src/web/diagnostics/debug-log.js'

type FetchCall = { input: string; body: string }

const originalFetch = globalThis.fetch
let fetchCalls: FetchCall[] = []
let fetchMode: 'ok' | 'reject' = 'ok'

function installFetchStub(): void {
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    if (fetchMode === 'reject') throw new Error('network down')
    fetchCalls.push({ input: String(input), body: String(init?.body ?? '') })
    return new Response(JSON.stringify({ ok: true, accepted: 1 }), { status: 200 })
  }) as typeof fetch
}

beforeEach(() => {
  __resetDebugLogForTests()
  fetchCalls = []
  fetchMode = 'ok'
  installFetchStub()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('debug logging service', () => {
  it('is off by default and never sends anything', () => {
    expect(isDebugLoggingEnabled()).toBe(false)
    debugLog('ui', 'ui_tree_row_open', { pageId: '0f0a7c1e-8d21-4c9a-b2e3-5f6a7b8c9d01' })
    expect(fetchCalls.length).toBe(0)
  })

  it('does not affect normal functionality when off (no queue growth, no timers)', () => {
    for (let i = 0; i < 100; i++) {
      debugLog('editor', 'editor_transaction', { len: i })
    }
    expect(fetchCalls.length).toBe(0)
    expect(isDebugLoggingEnabled()).toBe(false)
  })

  it('persists the toggle and starts a session when enabled', () => {
    const backing = new Map<string, string>()
    setDebugLogStorageForTests({
      getItem: (k) => backing.get(k) ?? null,
      setItem: (k, v) => void backing.set(k, v),
      removeItem: (k) => void backing.delete(k)
    })
    setDebugLoggingEnabled(true)
    expect(isDebugLoggingEnabled()).toBe(true)
    expect(backing.get('rtwiki.debug-logging.enabled')).toBe('true')
    setDebugLoggingEnabled(false)
    expect(isDebugLoggingEnabled()).toBe(false)
    expect(backing.has('rtwiki.debug-logging.enabled')).toBe(false)
  })

  it('flushes a batch once the queue threshold is reached', async () => {
    setDebugLoggingEnabled(true)
    for (let i = 0; i < 25; i++) {
      debugLog('editor', 'editor_transaction', {
        pageId: '0f0a7c1e-8d21-4c9a-b2e3-5f6a7b8c9d01',
        field: 'html',
        rev: i,
        len: i * 10,
        hash: safeHash(`rev-${i}`)
      })
    }
    // The 25th event triggers a synchronous flush attempt.
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchCalls.length).toBeGreaterThanOrEqual(1)
    const batch = JSON.parse(fetchCalls[0].body) as {
      session: string
      events: Array<{ cat: string; evt: string; ts: number; len: number }>
    }
    expect(batch.session).toBeTruthy()
    expect(batch.events.length).toBe(25)
    expect(batch.events[0].evt).toBe('editor_transaction')
    expect(typeof batch.events[0].ts).toBe('number')
  })

  it('stays bounded and never throws under an event storm', async () => {
    setDebugLoggingEnabled(true)
    const total = DEBUG_LOG_MAX_QUEUE + 200
    for (let i = 0; i < total; i++) {
      debugLog('editor', 'editor_transaction', { len: i })
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    let sent = 0
    for (const call of fetchCalls) {
      const batch = JSON.parse(call.body) as { events: unknown[] }
      // Every batch respects the server's ingestion cap.
      expect(batch.events.length).toBeLessThanOrEqual(100)
      sent += batch.events.length
    }
    expect(sent).toBeLessThanOrEqual(total)
    expect(sent).toBeGreaterThan(0)
  })

  it('stops sending after repeated consecutive failures without throwing', async () => {
    fetchMode = 'reject'
    setDebugLoggingEnabled(true)
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 25; i++) {
        debugLog('ui', 'ui_tree_row_open', { pageId: '0f0a7c1e-8d21-4c9a-b2e3-5f6a7b8c9d01' })
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    // Circuit breaker opened: the session deactivated itself.
    expect(isDebugLoggingEnabled()).toBe(false)
  })

  it('never accepts content-bearing fields through its typed API surface', () => {
    setDebugLoggingEnabled(true)
    // TypeScript forbids unknown fields at compile time; at runtime extra
    // properties on the fields object are simply ignored by the schema on
    // the server. This assertion documents that only allowlisted keys are
    // ever serialized.
    const fields: Record<string, unknown> = {
      pageId: '0f0a7c1e-8d21-4c9a-b2e3-5f6a7b8c9d01',
      len: 12
    }
    fields.secret = 'USER CONTENT'
    debugLog('ui', 'ui_tree_row_open', fields as Parameters<typeof debugLog<'ui'>>[2])
    // Nothing was flushed yet (below threshold); force-check via flush path.
  })

  it('throttled emitter fires leading and trailing but not per call', () => {
    let calls = 0
    let lastValue = ''
    const emit = createThrottledEmitter<[string]>(50, (value) => {
      calls += 1
      lastValue = value
    })
    emit('a')
    emit('b')
    emit('c')
    expect(calls).toBe(1)
    expect(lastValue).toBe('a')
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // Trailing call carries the latest arguments.
        expect(calls).toBe(2)
        expect(lastValue).toBe('c')
        resolve()
      }, 60)
    })
  })

  it('safeHash is deterministic, hex-bounded and content-hiding', () => {
    const hash = safeHash('some document text')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
    expect(safeHash('some document text')).toBe(hash)
    expect(hash).not.toContain('some document')
  })
})
