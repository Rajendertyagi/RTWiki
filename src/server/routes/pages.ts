import { MAX_PAGE_JSON_BODY_BYTES } from '@rtwiki/shared/constants'
import { PageMoveSchema } from '@rtwiki/shared/schemas/page-move'
import { CreatePageSchema, UpdatePageSchema } from '@rtwiki/shared/schemas/pages'
import type { Context } from 'hono'
import { Hono } from 'hono'
import type { getDb } from '../database/index.js'
// The version conflict is raised by the repository's guarded write, and the
// service layer passes it through untranslated, so the route maps it to 409.
// `page-service.ts` re-exports `HierarchyError` for the same reason; re-exporting
// this class there would be the tidier home, but the route is the only layer that
// turns repository errors into HTTP, and one mapping beats two that can disagree.
import { PageVersionConflictError } from '../repositories/page-repository.js'
import * as service from '../services/page-service.js'
import { type JsonBodyResult, readJson } from '../utils/read-json.js'

/**
 * Ceiling on the `q` search term. Page search is a substring match over every
 * indexed page, so an unbounded term asks for unbounded work; 200 characters is
 * far beyond any real search phrase. Rejection mirrors the body ceiling below —
 * an explicit check with a clear message — and is never a silent clamp, because
 * results for a truncated term would answer a question the user never asked.
 */
const MAX_SEARCH_QUERY_LENGTH = 200

/**
 * What the user is told when a write is rejected because the page moved on.
 * Nothing was stored, so the text they typed is still in the editor: say so, and
 * tell them to take a copy before reloading.
 */
const PAGE_VERSION_CONFLICT_MESSAGE =
  'This page was changed in another tab or window, so your changes were not saved. Copy your text, then reload the page and add it again.'

/**
 * Reads this route family's request body.
 *
 * A thin call into the shared reader rather than a private copy. The byte ceiling
 * differs from the schedule's — pages carry BlockNote JSON, which is larger than a
 * timetable entry — so it is passed in, but the media-type rule and the refusal
 * order are the shared ones and cannot drift from the other JSON routes.
 */
async function readJsonBody(c: Context): Promise<JsonBodyResult> {
  return readJson(c, MAX_PAGE_JSON_BODY_BYTES)
}

export function createPageRoutes(getDbFn: () => ReturnType<typeof getDb>): Hono {
  const routes = new Hono()

  routes.get('/', (c) => {
    try {
      const db = getDbFn()
      const search = c.req.query('q') || undefined
      if (search !== undefined && search.length > MAX_SEARCH_QUERY_LENGTH) {
        return c.json(
          {
            error: `Search text is limited to ${MAX_SEARCH_QUERY_LENGTH} characters. Shorten your search.`
          },
          400
        )
      }
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
    // The shared reader answers every failure itself, so a non-ok result is always
    // a response to return. The private reader this replaced had a second,
    // unreachable "not handled" branch that fell through to a generic message.
    if (!bodyResult.ok) {
      return bodyResult.response
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

  routes.get('/trash', (c) => {
    try {
      const db = getDbFn()
      const result = service.listTrashedPages(db)
      return c.json(result)
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

  // Living pages whose Rich Note content links to this page (exact ID-based
  // relationships from the maintained page_links index).
  routes.get('/:id/backlinks', (c) => {
    try {
      const db = getDbFn()
      const id = c.req.param('id')
      const backlinks = service.listBacklinks(db, id)
      return c.json({ backlinks })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  // Living pages this page links to (outgoing relationships).
  routes.get('/:id/links', (c) => {
    try {
      const db = getDbFn()
      const id = c.req.param('id')
      const links = service.listOutgoingLinks(db, id)
      return c.json({ links })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  routes.patch('/:id', async (c) => {
    const bodyResult = await readJsonBody(c)
    if (!bodyResult.ok) {
      return bodyResult.response
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
      if (err instanceof PageVersionConflictError) {
        return c.json({ error: PAGE_VERSION_CONFLICT_MESSAGE }, 409)
      }
      if (err instanceof service.PageValidationError) {
        return c.json({ error: err.message }, 400)
      }
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  routes.post('/:id/move', async (c) => {
    const bodyResult = await readJsonBody(c)
    if (!bodyResult.ok) {
      return bodyResult.response
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

  routes.post('/:id/restore', (c) => {
    try {
      const db = getDbFn()
      const id = c.req.param('id')
      const page = service.restorePage(db, id)
      if (!page) {
        return c.json({ error: 'Page not found in trash' }, 404)
      }
      return c.json({ page })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  routes.delete('/:id/permanent', (c) => {
    try {
      const db = getDbFn()
      const id = c.req.param('id')
      const deleted = service.permanentlyDeletePage(db, id)
      if (!deleted) {
        return c.json({ error: 'Page not found in trash' }, 404)
      }
      return c.json({ ok: true })
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
