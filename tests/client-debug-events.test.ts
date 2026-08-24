import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { DebugEventSink } from '../src/server/routes/client-debug-events.js'
import { createClientDebugEventRoutes } from '../src/server/routes/client-debug-events.js'
import { CLIENT_DEBUG_RATE_LIMIT_MAX } from '../src/shared/constants/index.js'

class MemorySink implements DebugEventSink {
  readonly records: Array<Record<string, unknown>> = []

  append(event: Record<string, unknown>): void {
    this.records.push(event)
  }
}

const TOKEN = 'test-shutdown-token-abc123'

function build(): { app: Hono; sink: MemorySink } {
  const sink = new MemorySink()
  const router = createClientDebugEventRoutes({ sink, scrubValues: [TOKEN] })
  const app = new Hono().route('/api/client-debug-events', router)
  return { app, sink }
}

const JSON_HEADERS = { 'content-type': 'application/json' }

function validBatch(): Record<string, unknown> {
  return {
    session: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    events: [
      {
        ts: Date.now(),
        cat: 'editor',
        evt: 'editor_transaction',
        pageId: '0f0a7c1e-8d21-4c9a-b2e3-5f6a7b8c9d01',
        field: 'html',
        rev: 4,
        len: 220,
        hash: 'deadbeef'
      }
    ]
  }
}

describe('client debug-event ingestion endpoint', () => {
  it('accepts a valid batch and appends one record per event with the session merged', async () => {
    const { app, sink } = build()
    const res = await app.request('/api/client-debug-events', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(validBatch())
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; accepted: number }
    expect(body.ok).toBe(true)
    expect(body.accepted).toBe(1)

    expect(sink.records.length).toBe(1)
    const record = sink.records[0]
    expect(record.evt).toBe('editor_transaction')
    expect(record.session).toBe('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')
    expect(record.cat).toBe('editor')
  })

  it('rejects cross-origin requests (localhost-only ingestion)', async () => {
    const { app, sink } = build()
    const res = await app.request('/api/client-debug-events', {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin: 'https://evil.example' },
      body: JSON.stringify(validBatch())
    })
    expect(res.status).toBe(403)
    expect(sink.records.length).toBe(0)
  })

  it('rejects non-JSON content types and malformed bodies', async () => {
    const { app } = build()
    const wrongType = await app.request('/api/client-debug-events', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(validBatch())
    })
    expect(wrongType.status).toBe(400)

    const malformed = await app.request('/api/client-debug-events', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{ not json'
    })
    expect(malformed.status).toBe(400)
  })

  it('enforces the payload cap before parsing', async () => {
    const { app } = build()
    const batch = validBatch() as Record<string, unknown>
    batch.events = Array.from({ length: 100 }, () => ({
      ts: Date.now(),
      cat: 'navigation',
      evt: 'nav_session_invalid_discarded',
      pageId: '0f0a7c1e-8d21-4c9a-b2e3-5f6a7b8c9d01',
      targetId: '0f0a7c1e-8d21-4c9a-b2e3-5f6a7b8c9d02',
      tabId: '0f0a7c1e-8d21-4c9a-b2e3-5f6a7b8c9d03',
      field: 'javascript',
      rev: 999999,
      gen: 999999,
      len: 999999,
      hash: 'deadbeef',
      durMs: 123456.789,
      result: 'skipped',
      code: 'x'.repeat(64)
    }))
    const oversized = JSON.stringify(batch)
    expect(Buffer.byteLength(oversized, 'utf8')).toBeGreaterThan(32 * 1024)
    const res = await app.request('/api/client-debug-events', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: oversized
    })
    expect(res.status).toBe(413)
  })

  it('REJECTS unknown fields (strict schema) and never persists their values', async () => {
    const { app, sink } = build()
    const batch = validBatch() as Record<string, unknown>
    batch.events = [
      {
        ...(validBatch().events as Array<Record<string, unknown>>)[0],
        pageTitle: 'SECRET PAGE TITLE',
        domText: 'SECRET DOM TEXT'
      }
    ]
    const res = await app.request('/api/client-debug-events', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(batch)
    })
    expect(res.status).toBe(400)
    expect(sink.records.length).toBe(0)
  })

  it('rejects category/name mismatches and unknown event names', async () => {
    const { app } = build()
    const mismatched = validBatch() as Record<string, unknown>
    mismatched.events = [{ ts: Date.now(), cat: 'ui', evt: 'autosave_success' }]
    const badName = validBatch() as Record<string, unknown>
    badName.events = [{ ts: Date.now(), cat: 'ui', evt: 'free_form_label' }]

    for (const body of [mismatched, badName]) {
      const res = await app.request('/api/client-debug-events', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body)
      })
      expect(res.status).toBe(400)
    }
  })

  it('scrubs the shutdown token out of persisted token fields', async () => {
    const { app, sink } = build()
    const batch = validBatch() as Record<string, unknown>
    batch.events = [
      {
        ts: Date.now(),
        cat: 'ui',
        evt: 'ui_context_menu_action',
        pageId: `page-${TOKEN}-tail`,
        code: 'rename'
      }
    ]
    const res = await app.request('/api/client-debug-events', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(batch)
    })
    expect(res.status).toBe(200)
    const serialized = JSON.stringify(sink.records)
    expect(serialized).not.toContain(TOKEN)
    expect(serialized).toContain('[redacted]')
  })

  it('rate-limits batches', async () => {
    const { app } = build()
    for (let i = 0; i < CLIENT_DEBUG_RATE_LIMIT_MAX; i++) {
      const res = await app.request('/api/client-debug-events', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(validBatch())
      })
      expect(res.status).toBe(200)
    }
    const limited = await app.request('/api/client-debug-events', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(validBatch())
    })
    expect(limited.status).toBe(429)
  })

  it('returns 405 for GET and exposes no way to read logs over HTTP', async () => {
    const { app } = build()
    const getRoot = await app.request('/api/client-debug-events')
    expect(getRoot.status).toBe(405)

    const logAttempt = await app.request('/logs/rtwiki-debug.jsonl')
    expect(logAttempt.status).toBe(404)
  })
})
