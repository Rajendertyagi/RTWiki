import { Hono } from 'hono'
import { CreatePageSchema, UpdatePageSchema } from '@rtwiki/shared/schemas/pages'
import * as service from '../services/page-service.js'
import type { getDb } from '../database/index.js'

export function createPageRoutes(getDbFn: () => ReturnType<typeof getDb>): Hono {
  const routes = new Hono()

  routes.get('/', (c) => {
    try {
      const db = getDbFn()
      const search = c.req.query('q') || undefined
      const limit = Number(c.req.query('limit')) || 50
      const offset = Number(c.req.query('offset')) || 0
      const result = service.listPages(db, { search, limit, offset })
      return c.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  routes.post('/', async (c) => {
    try {
      const body = await c.req.json()
      const parsed = CreatePageSchema.safeParse(body)
      if (!parsed.success) {
        return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
      }
      const db = getDbFn()
      const page = service.createPage(db, parsed.data)
      return c.json({ page }, 201)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  routes.get('/:id', (c) => {
    try {
      const db = getDbFn()
      const id = c.req.param('id')
      const page = service.getPage(db, id)
      if (!page) {
        return c.json({ error: 'Page not found' }, 404)
      }
      return c.json({ page })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  routes.patch('/:id', async (c) => {
    try {
      const body = await c.req.json()
      const parsed = UpdatePageSchema.safeParse(body)
      if (!parsed.success) {
        return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
      }
      const db = getDbFn()
      const id = c.req.param('id')
      const page = service.updatePage(db, id, parsed.data)
      if (!page) {
        return c.json({ error: 'Page not found' }, 404)
      }
      return c.json({ page })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  routes.post('/:id/duplicate', (c) => {
    try {
      const db = getDbFn()
      const id = c.req.param('id')
      const page = service.duplicatePage(db, id)
      if (!page) {
        return c.json({ error: 'Page not found' }, 404)
      }
      return c.json({ page }, 201)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  routes.delete('/:id', (c) => {
    try {
      const db = getDbFn()
      const id = c.req.param('id')
      const deleted = service.softDeletePage(db, id)
      if (!deleted) {
        return c.json({ error: 'Page not found' }, 404)
      }
      return c.json({ ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  return routes
}