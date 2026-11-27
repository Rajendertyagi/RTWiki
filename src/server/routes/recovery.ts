import { Hono } from 'hono'
import type { getDb } from '../database/index.js'
import * as service from '../services/page-service.js'

/**
 * Bounded window for the recent-operations view. Defined here, where it is
 * used, rather than repeated as a literal in the handler.
 */
const MAX_OPERATIONS_RETURNED = 100

/**
 * Read-only view over the recovery operation log. Only the eight recovery
 * operations are ever written to that table; this route does not create a
 * general activity feed.
 */
export function createRecoveryRoutes(getDbFn: () => ReturnType<typeof getDb>): Hono {
  const routes = new Hono()

  routes.get('/operations', (c) => {
    try {
      const db = getDbFn()
      return c.json({ operations: service.listRecoveryOperations(db, MAX_OPERATIONS_RETURNED) })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  return routes
}
