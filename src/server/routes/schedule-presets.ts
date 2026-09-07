import {
  applyPresetSchema,
  createPresetSchema,
  updatePresetSchema
} from '@rtwiki/shared/schemas/schedule'
import type { Context } from 'hono'
import { Hono } from 'hono'
import type { getDb } from '../database/index.js'
import * as service from '../services/schedule-service.js'

type BodyResult = { ok: true; body: unknown } | { ok: false; error: string }

async function readJson(c: Context): Promise<BodyResult> {
  try {
    const text = await c.req.text()
    if (text.length === 0) return { ok: false, error: 'Empty request body' }
    return { ok: true, body: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, error: 'Invalid JSON' }
  }
}

function badRequest(c: Context, message: string): Response {
  return c.json({ error: message }, 400)
}

export function createSchedulePresetRoutes(getDbFn: () => ReturnType<typeof getDb>): Hono {
  const routes = new Hono()

  routes.get('/', (c) => {
    try {
      const db = getDbFn()
      return c.json({ presets: service.listPresets(db) })
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 500)
    }
  })

  routes.post('/', async (c) => {
    const body = await readJson(c)
    if (!body.ok) return badRequest(c, body.error)
    const parsed = createPresetSchema.safeParse(body.body)
    if (!parsed.success) {
      return badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid preset')
    }
    try {
      const db = getDbFn()
      const preset = service.createPreset(db, parsed.data.name, parsed.data.data)
      return c.json({ preset }, 201)
    } catch (err) {
      if (err instanceof service.ScheduleValidationError) {
        return badRequest(c, err.message)
      }
      return c.json({ error: errorMessage(err) }, 500)
    }
  })

  routes.patch('/:id', async (c) => {
    const body = await readJson(c)
    if (!body.ok) return badRequest(c, body.error)
    const parsed = updatePresetSchema.safeParse(body.body)
    if (!parsed.success) {
      return badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid preset')
    }
    try {
      const db = getDbFn()
      const preset = service.updatePreset(db, c.req.param('id'), parsed.data)
      if (!preset) return c.json({ error: 'Preset not found' }, 404)
      return c.json({ preset })
    } catch (err) {
      if (err instanceof service.ScheduleValidationError) {
        return badRequest(c, err.message)
      }
      return c.json({ error: errorMessage(err) }, 500)
    }
  })

  routes.delete('/:id', (c) => {
    try {
      const db = getDbFn()
      const ok = service.deletePreset(db, c.req.param('id'))
      if (!ok) return c.json({ error: 'Preset not found' }, 404)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 500)
    }
  })

  // Apply a built-in or custom preset to the current timetable.
  routes.post('/apply', async (c) => {
    const body = await readJson(c)
    if (!body.ok) return badRequest(c, body.error)
    const parsed = applyPresetSchema.safeParse(body.body)
    if (!parsed.success) {
      return badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid apply request')
    }
    try {
      const db = getDbFn()
      service.applyPreset(db, parsed.data.source, parsed.data.mode)
      return c.json({ ok: true })
    } catch (err) {
      if (err instanceof service.ScheduleValidationError) {
        return badRequest(c, err.message)
      }
      return c.json({ error: errorMessage(err) }, 500)
    }
  })

  return routes
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
