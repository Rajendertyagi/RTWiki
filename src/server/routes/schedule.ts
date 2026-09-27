import { MAX_SCHEDULE_JSON_BODY_BYTES } from '@rtwiki/shared/constants'
import { reminderSchema, scheduleEntrySchema } from '@rtwiki/shared/schemas/schedule'
import type { Context } from 'hono'
import { Hono } from 'hono'
import type { getDb } from '../database/index.js'
import * as service from '../services/schedule-service.js'

const requestTextEncoder = new TextEncoder()

/** A JSON body that was read and parsed, or a response the caller must return. */
export type JsonBodyResult = { ok: true; body: unknown } | { ok: false; response: Response }

/**
 * Reads a schedule/preset JSON request body under an enforced byte ceiling.
 *
 * Shared by the schedule and schedule-preset routes so the ceiling has exactly
 * one definition: Content-Length is checked first (a cheap refusal that never
 * reads the body), then the byte length of the text actually read (authoritative,
 * and the only check that applies to a chunked request with no declared length).
 * Malformed and empty bodies stay 400s — a client that sent bad JSON must not be
 * told it sent too much and go looking in the wrong place.
 *
 * This is the same contract as `readJsonBody` in `routes/pages.ts`, which is
 * currently owned by a separate in-flight change and still carries its own
 * private copy. When that file is next editable both should read this one; the
 * seam is here rather than in a third copy of the same check.
 */
export async function readJson(c: Context): Promise<JsonBodyResult> {
  const contentLength = Number(c.req.header('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_SCHEDULE_JSON_BODY_BYTES) {
    return { ok: false, response: c.json({ error: 'Request body too large' }, 413) }
  }

  const text = await c.req.text()
  if (requestTextEncoder.encode(text).byteLength > MAX_SCHEDULE_JSON_BODY_BYTES) {
    return { ok: false, response: c.json({ error: 'Request body too large' }, 413) }
  }
  if (text.length === 0) {
    return { ok: false, response: c.json({ error: 'Empty request body' }, 400) }
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, response: c.json({ error: 'Invalid JSON' }, 400) }
  }
}

function badRequest(c: Context, message: string): Response {
  return c.json({ error: message }, 400)
}

export function createScheduleRoutes(getDbFn: () => ReturnType<typeof getDb>): Hono {
  const routes = new Hono()

  // ---- Schedule entries ----
  routes.get('/entries', (c) => {
    try {
      const db = getDbFn()
      return c.json({ entries: service.listScheduleEntries(db) })
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 500)
    }
  })

  routes.post('/entries', async (c) => {
    const body = await readJson(c)
    if (!body.ok) return body.response
    const parsed = scheduleEntrySchema.safeParse(body.body)
    if (!parsed.success) {
      return badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid entry')
    }
    try {
      const db = getDbFn()
      const entry = service.createScheduleEntry(db, parsed.data)
      return c.json({ entry }, 201)
    } catch (err) {
      if (err instanceof service.ScheduleValidationError) {
        return badRequest(c, err.message)
      }
      return c.json({ error: errorMessage(err) }, 500)
    }
  })

  routes.get('/entries/:id', (c) => {
    try {
      const db = getDbFn()
      const found = service.listScheduleEntries(db).find((e) => e.id === c.req.param('id'))
      if (!found) return c.json({ error: 'Entry not found' }, 404)
      return c.json({ entry: found })
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 500)
    }
  })

  routes.patch('/entries/:id', async (c) => {
    const body = await readJson(c)
    if (!body.ok) return body.response
    const parsed = scheduleEntrySchema.safeParse(body.body)
    if (!parsed.success) {
      return badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid entry')
    }
    try {
      const db = getDbFn()
      const entry = service.updateScheduleEntry(db, c.req.param('id'), parsed.data)
      if (!entry) return c.json({ error: 'Entry not found' }, 404)
      return c.json({ entry })
    } catch (err) {
      if (err instanceof service.ScheduleValidationError) {
        return badRequest(c, err.message)
      }
      return c.json({ error: errorMessage(err) }, 500)
    }
  })

  routes.delete('/entries/:id', (c) => {
    try {
      const db = getDbFn()
      const ok = service.deleteScheduleEntry(db, c.req.param('id'))
      if (!ok) return c.json({ error: 'Entry not found' }, 404)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 500)
    }
  })

  // ---- Reminders ----
  routes.get('/reminders', (c) => {
    try {
      const db = getDbFn()
      return c.json({ reminders: service.listReminders(db) })
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 500)
    }
  })

  routes.post('/reminders', async (c) => {
    const body = await readJson(c)
    if (!body.ok) return body.response
    const parsed = reminderSchema.safeParse(body.body)
    if (!parsed.success) {
      return badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid reminder')
    }
    try {
      const db = getDbFn()
      const reminder = service.createReminder(db, parsed.data)
      return c.json({ reminder }, 201)
    } catch (err) {
      if (err instanceof service.ScheduleValidationError) {
        return badRequest(c, err.message)
      }
      return c.json({ error: errorMessage(err) }, 500)
    }
  })

  routes.get('/reminders/:id', (c) => {
    try {
      const db = getDbFn()
      const found = service.listReminders(db).find((r) => r.id === c.req.param('id'))
      if (!found) return c.json({ error: 'Reminder not found' }, 404)
      return c.json({ reminder: found })
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 500)
    }
  })

  routes.patch('/reminders/:id', async (c) => {
    const body = await readJson(c)
    if (!body.ok) return body.response
    const parsed = reminderSchema.safeParse(body.body)
    if (!parsed.success) {
      return badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid reminder')
    }
    try {
      const db = getDbFn()
      const reminder = service.updateReminder(db, c.req.param('id'), parsed.data)
      if (!reminder) return c.json({ error: 'Reminder not found' }, 404)
      return c.json({ reminder })
    } catch (err) {
      if (err instanceof service.ScheduleValidationError) {
        return badRequest(c, err.message)
      }
      return c.json({ error: errorMessage(err) }, 500)
    }
  })

  routes.delete('/reminders/:id', (c) => {
    try {
      const db = getDbFn()
      const ok = service.deleteReminder(db, c.req.param('id'))
      if (!ok) return c.json({ error: 'Reminder not found' }, 404)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 500)
    }
  })

  return routes
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
