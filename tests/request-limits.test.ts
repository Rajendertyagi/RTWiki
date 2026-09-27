import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createConfig } from '../src/server/config/index.js'
import { closeDatabase, type getDb, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { createScheduleRoutes } from '../src/server/routes/schedule.js'
import { createSchedulePresetRoutes } from '../src/server/routes/schedule-presets.js'
import * as constants from '../src/shared/constants/index.js'

function makeTempDir(): string {
  const dir = join(tmpdir(), `rtwiki-limits-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

const JSON_HEADERS = { 'content-type': 'application/json' }

/** A weekly period that satisfies scheduleEntrySchema, with room to pad `notes`. */
function scheduleEntryWithNotes(notes: string): Record<string, unknown> {
  return {
    recurrenceKind: 'weekly',
    title: 'Mathematics',
    weekdays: [1],
    date: null,
    startTime: '08:00',
    endTime: '09:00',
    linkedPageId: null,
    category: null,
    color: null,
    notes,
    notifications: {
      enabled: true,
      start: true,
      fiveMinBefore: true,
      customOffsets: []
    }
  }
}

function presetWithPeriods(periodCount: number, noteSize: number): Record<string, unknown> {
  return {
    name: 'Autumn term',
    data: {
      periods: Array.from({ length: periodCount }, (_, i) => ({
        title: `Period ${i + 1}`,
        recurrenceKind: 'weekly',
        weekdays: [1, 2, 3, 4, 5],
        date: null,
        startTime: '08:00',
        endTime: '09:00',
        category: null,
        color: null,
        notes: 'n'.repeat(noteSize),
        linkedPageId: null,
        notifications: {
          enabled: true,
          start: true,
          fiveMinBefore: true,
          customOffsets: []
        }
      })),
      reminders: []
    }
  }
}

describe('MAX_REQUEST_SIZE is not dead configuration', () => {
  it('is not exported by the shared constants module', () => {
    // The audit found a 100 MB ceiling that was declared, imported, typed and
    // assigned — and read by nothing. A ceiling nobody consults is worse than no
    // ceiling, because every document that mentions it tells the next reader a
    // limit exists. The constant must be gone from the module, not merely
    // ignored, so nothing can cite it again.
    const exported = constants as unknown as Record<string, unknown>
    expect('MAX_REQUEST_SIZE' in exported).toBe(false)
  })

  it('is not carried on the AppConfig the server builds', () => {
    const cfg = createConfig('/app') as unknown as Record<string, unknown>
    expect('maxRequestSize' in cfg).toBe(false)
  })
})

describe('schedule and preset request-body limits', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>
  let app: Hono

  beforeAll(async () => {
    tempDir = makeTempDir()
    db = initDatabase(tempDir)
    await runMigrations(db)
    app = new Hono()
      .route(
        '/api/schedule',
        createScheduleRoutes(() => db)
      )
      .route(
        '/api/schedule/presets',
        createSchedulePresetRoutes(() => db)
      )
  })

  afterAll(async () => {
    await closeDatabase()
    cleanup(tempDir)
  })

  it('declares a schedule/preset body ceiling in the shared constants module', () => {
    // Read through the namespace so the failure names the missing export instead
    // of failing at import time.
    const cap = (constants as unknown as Record<string, unknown>).MAX_SCHEDULE_JSON_BODY_BYTES
    expect(typeof cap).toBe('number')
    // A timetable is a list of small period/reminder records, not a document.
    // The cap must be a real ceiling, and it must be far below the 4 MB page
    // ceiling and the 50 MB attachment ceiling it sits beside.
    expect(cap as number).toBeGreaterThan(0)
    expect(cap as number).toBeLessThan(constants.MAX_PAGE_JSON_BODY_BYTES)
  })

  it('rejects an oversized schedule entry before parsing it', async () => {
    const cap = constants.MAX_SCHEDULE_JSON_BODY_BYTES
    const body = JSON.stringify(scheduleEntryWithNotes('n'.repeat(cap + 1024)))

    const res = await app.request('/api/schedule/entries', {
      method: 'POST',
      headers: JSON_HEADERS,
      body
    })

    expect(res.status).toBe(413)
    const payload = (await res.json()) as { error?: string }
    expect(payload.error).toContain('too large')
    // Nothing may be persisted from a refused body.
    expect(db.query('SELECT COUNT(*) AS n FROM schedule_entries').get()).toEqual({ n: 0 })
  })

  it('rejects an oversized schedule entry on the declared Content-Length alone', async () => {
    // The pre-check exists so an honest oversized request is refused without its
    // body ever being read. It is a different branch from the post-read check and
    // is asserted separately, because a `Request` built by the Fetch API carries
    // no Content-Length at all.
    const cap = constants.MAX_SCHEDULE_JSON_BODY_BYTES
    const body = JSON.stringify(scheduleEntryWithNotes('n'.repeat(cap + 1024)))

    const res = await app.request('/api/schedule/entries', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'content-length': String(body.length) },
      body
    })

    expect(res.status).toBe(413)
    expect(db.query('SELECT COUNT(*) AS n FROM schedule_entries').get()).toEqual({ n: 0 })
  })

  it('rejects an oversized schedule preset before parsing it', async () => {
    const cap = constants.MAX_SCHEDULE_JSON_BODY_BYTES
    // A plausible shape that simply has too many periods: 400 periods of 8 KB
    // notes each is ~3.2 MB of JSON describing a timetable.
    const body = JSON.stringify(presetWithPeriods(400, 8 * 1024))
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(cap)

    const res = await app.request('/api/schedule/presets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body
    })

    expect(res.status).toBe(413)
    const payload = (await res.json()) as { error?: string }
    expect(payload.error).toContain('too large')
    expect(db.query('SELECT COUNT(*) AS n FROM schedule_presets').get()).toEqual({ n: 0 })
  })

  it('still accepts a normal schedule entry', async () => {
    const res = await app.request('/api/schedule/entries', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(scheduleEntryWithNotes('Bring a calculator'))
    })

    expect(res.status).toBe(201)
    const payload = (await res.json()) as { entry?: { title?: string } }
    expect(payload.entry?.title).toBe('Mathematics')
  })

  it('still accepts a normal preset', async () => {
    const res = await app.request('/api/schedule/presets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(presetWithPeriods(6, 64))
    })

    expect(res.status).toBe(201)
    const payload = (await res.json()) as { preset?: { name?: string } }
    expect(payload.preset?.name).toBe('Autumn term')
  })

  it('rejects a malformed body as invalid JSON, not as oversized', async () => {
    // The size check must not swallow the parse error, or a client sending bad
    // JSON would be told it sent too much and go looking in the wrong place.
    const res = await app.request('/api/schedule/entries', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{ not json'
    })

    expect(res.status).toBe(400)
    const payload = (await res.json()) as { error?: string }
    expect(payload.error).toBe('Invalid JSON')
  })
})
