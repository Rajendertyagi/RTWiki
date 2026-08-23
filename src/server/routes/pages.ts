import { MAX_PAGE_JSON_BODY_BYTES } from '@rtwiki/shared/constants'
import { PageMoveSchema } from '@rtwiki/shared/schemas/page-move'
import { CreatePageSchema, UpdatePageSchema } from '@rtwiki/shared/schemas/pages'
import type { Context } from 'hono'
import { Hono } from 'hono'
import type { getDb } from '../database/index.js'
import * as service from '../services/page-service.js'

const requestTextEncoder = new TextEncoder()

type BodyResult = { ok: true; body: unknown } | { ok: false; handled: false }
type HandledBodyResult = { ok: false; handled: true; response: Response }

/**
 * Reads the request body with an enforced byte ceiling before any parsing.
 *
 * The Content-Length header is checked first (cheap rejection), then the raw
 * byte length of the actually-read text (authoritative). Malformed JSON is a
 * client error (400), not a server fault.
 */
async function readJsonBody(c: Context): Promise<BodyResult | HandledBodyResult> {
  const contentLength = Number(c.req.header('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_PAGE_JSON_BODY_BYTES) {
    return {
      ok: false,
      handled: true,
      response: c.json({ error: 'Request body too large' }, 413)
    }
  }

  const raw = await c.req.text()
  if (requestTextEncoder.encode(raw).byteLength > MAX_PAGE_JSON_BODY_BYTES) {
    return {
      ok: false,
      handled: true,
      response: c.json({ error: 'Request body too large' }, 413)
    }
  }

  try {
    return { ok: true, body: JSON.parse(raw) as unknown }
  } catch {
    return {
      ok: false,
      handled: true,
      response: c.json({ error: 'Invalid JSON' }, 400)
    }
  }
}

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
    const bodyResult = await readJsonBody(c)
    if (!bodyResult.ok && bodyResult.handled) {
      return bodyResult.response
    }
    if (!bodyResult.ok) {
      return c.json({ error: 'Invalid input' }, 400)
    }
    try {
      const parsed = CreatePageSchema.safeParse(bodyResult.body)
      if (!parsed.success) {
        return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
      }
      const db = getDbFn()
      const page = service.createPage(db, parsed.data)
      return c.json({ page }, 201)
    } catch (err) {
      if (err instanceof service.PageValidationError) {
        return c.json({ error: err.message }, 400)
      }
      if (err instanceof service.HierarchyError) {
        return c.json({ error: err.message }, err.status)
      }
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
    const bodyResult = await readJsonBody(c)
    if (!bodyResult.ok && bodyResult.handled) {
      return bodyResult.response
    }
    if (!bodyResult.ok) {
      return c.json({ error: 'Invalid input' }, 400)
    }

    // Page-type conversion is not supported in Phase 4A. The shared update
    // schema strips unknown keys silently, so presence is rejected here to
    // give clients an explicit, actionable error.
    if (
      bodyResult.body !== null &&
      typeof bodyResult.body === 'object' &&
      'pageType' in bodyResult.body
    ) {
      return c.json({ error: 'Page type conversion is not supported' }, 400)
    }

    // Hierarchy changes are out of scope for PATCH: moves happen only through
    // the dedicated move endpoint so cycle and sibling-order validation cannot
    // be bypassed.
    if (
      bodyResult.body !== null &&
      typeof bodyResult.body === 'object' &&
      'parentId' in bodyResult.body
    ) {
      return c.json({ error: 'Use POST /api/pages/:id/move to change page hierarchy' }, 400)
    }

    try {
      const parsed = UpdatePageSchema.safeParse(bodyResult.body)
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
      if (err instanceof service.PageValidationError) {
        return c.json({ error: err.message }, 400)
      }
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  routes.post('/:id/move', async (c) => {
    const bodyResult = await readJsonBody(c)
    if (!bodyResult.ok && bodyResult.handled) {
      return bodyResult.response
    }
    if (!bodyResult.ok) {
      return c.json({ error: 'Invalid input' }, 400)
    }
    try {
      const parsed = PageMoveSchema.safeParse(bodyResult.body)
      if (!parsed.success) {
        return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
      }
      const db = getDbFn()
      const id = c.req.param('id')
      const result = service.movePage(db, id, parsed.data.newParentId, parsed.data.newPosition)
      return c.json(result)
    } catch (err) {
      if (err instanceof service.HierarchyError) {
        return c.json({ error: err.message }, err.status)
      }
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
      if (err instanceof service.HierarchyError) {
        return c.json({ error: err.message }, err.status)
      }
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  return routes
}
