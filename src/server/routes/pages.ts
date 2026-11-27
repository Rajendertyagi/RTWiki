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
 * Pagination window. `limit` is bounded so a request cannot ask for the whole
 * table in one call, and both values must be genuine integers: `Number(x) || 50`
 * previously let a negative limit bypass the window and let an unbounded
 * positive one through. Invalid values are refused, never silently clamped —
 * a clamped answer would not be the page set the caller asked for.
 */
const DEFAULT_PAGE_LIMIT = 50
const MIN_PAGE_LIMIT = 1
const MAX_PAGE_LIMIT = 100
const MIN_PAGE_OFFSET = 0

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
      const limitRaw = c.req.query('limit')
      const offsetRaw = c.req.query('offset')
      const limit = limitRaw === undefined ? DEFAULT_PAGE_LIMIT : Number(limitRaw)
      const offset = offsetRaw === undefined ? MIN_PAGE_OFFSET : Number(offsetRaw)
      if (
        !Number.isInteger(limit) ||
        limit < MIN_PAGE_LIMIT ||
        limit > MAX_PAGE_LIMIT ||
        !Number.isInteger(offset) ||
        offset < MIN_PAGE_OFFSET
      ) {
        return c.json(
          {
            error: `Invalid pagination: limit must be an integer from ${MIN_PAGE_LIMIT} to ${MAX_PAGE_LIMIT} and offset a non-negative integer`
          },
          400
        )
      }
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

  // Bounded revision history. A permanently deleted page has no row and no
  // revisions, so it cannot be resurrected through this endpoint.
  routes.get('/:id/revisions', (c) => {
    try {
      const db = getDbFn()
      const id = c.req.param('id')
      const exists = db.query('SELECT 1 FROM pages WHERE id = ?').get(id)
      if (!exists) {
        return c.json({ error: 'Page not found' }, 404)
      }
      return c.json({ revisions: service.listPageRevisions(db, id) })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  // Undo to a specific pre-mutation snapshot. An expired or missing snapshot
  // answers 410 with a machine-readable code and changes nothing.
  routes.post('/:id/revisions/:revId/restore', (c) => {
    try {
      const db = getDbFn()
      const page = service.restorePage(db, c.req.param('id'), {
        revisionId: c.req.param('revId')
      })
      if (!page) {
        return c.json({ error: 'Page not found in trash' }, 404)
      }
      return c.json({ page })
    } catch (err) {
      if (err instanceof service.RecoveryDataExpiredError) {
        return c.json({ error: err.message, code: 'recovery_data_expired' }, 410)
      }
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
      // The UI's normal restore carries no revision id. Resolve the newest
      // usable pre-delete snapshot so hierarchy, links and search text come
      // back; pages trashed before migration 015 have none and keep the legacy
      // fallback inside restorePage.
      const revisionId = service.latestPreDeleteRevisionId(db, id)
      const page = service.restorePage(db, id, revisionId === undefined ? {} : { revisionId })
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
    // Irreversible deletes always require the explicit query-parameter speed
    // bump. It is not a security boundary; it stops an accidental call.
    if (c.req.query('confirm') !== 'permanent') {
      return c.json(
        { error: 'Permanent deletion requires confirmation', code: 'confirmation_required' },
        400
      )
    }
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
