import { reminderSchema, scheduleEntrySchema } from '@rtwiki/shared/schemas/schedule'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { describeRoute } from 'hono-openapi'
import type { getDb } from '../database/index.js'
import { AI_SAFE_TAG } from '../openapi/index.js'
import * as service from '../services/schedule-service.js'
import { type JsonBodyResult, readJson } from '../utils/read-json.js'

export type { JsonBodyResult }
// Re-exported so `schedule-presets.ts` keeps importing the reader from here,
// as it did before the reader moved to `utils/read-json.ts` to be shared with
// the backup routes. There is still exactly one implementation.
export { readJson }

function badRequest(c: Context, message: string): Response {
  return c.json({ error: message }, 400)
}

export function createScheduleRoutes(getDbFn: () => ReturnType<typeof getDb>): Hono {
  const routes = new Hono()

  // ---- Schedule entries ----
  routes.get(
    '/entries',
    describeRoute({
      tags: [AI_SAFE_TAG],
      summary: 'List schedule entries',
      responses: { 200: { description: 'Schedule entries' } }
    }),
    (c) => {
      try {
        const db = getDbFn()
        return c.json({ entries: service.listScheduleEntries(db) })
      } catch (err) {
        return c.json({ error: errorMessage(err) }, 500)
      }
    }
  )

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

  routes.get(
    '/entries/:id',
    describeRoute({
      tags: [AI_SAFE_TAG],
      summary: 'Get a schedule entry by id',
      responses: { 200: { description: 'Schedule entry' }, 404: { description: 'Not found' } }
    }),
    (c) => {
      try {
        const db = getDbFn()
        const found = service.listScheduleEntries(db).find((e) => e.id === c.req.param('id'))
        if (!found) return c.json({ error: 'Entry not found' }, 404)
        return c.json({ entry: found })
      } catch (err) {
        return c.json({ error: errorMessage(err) }, 500)
      }
    }
  )

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
  routes.get(
    '/reminders',
    describeRoute({
      tags: [AI_SAFE_TAG],
      summary: 'List reminders',
      responses: { 200: { description: 'Reminders' } }
    }),
    (c) => {
      try {
        const db = getDbFn()
        return c.json({ reminders: service.listReminders(db) })
      } catch (err) {
        return c.json({ error: errorMessage(err) }, 500)
      }
    }
  )

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

  routes.get(
    '/reminders/:id',
    describeRoute({
      tags: [AI_SAFE_TAG],
      summary: 'Get a reminder by id',
      responses: { 200: { description: 'Reminder' }, 404: { description: 'Not found' } }
    }),
    (c) => {
      try {
        const db = getDbFn()
        const found = service.listReminders(db).find((r) => r.id === c.req.param('id'))
        if (!found) return c.json({ error: 'Reminder not found' }, 404)
        return c.json({ reminder: found })
      } catch (err) {
        return c.json({ error: errorMessage(err) }, 500)
      }
    }
  )

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
