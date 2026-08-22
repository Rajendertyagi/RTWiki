import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { HEALTH_PATH } from '@rtwiki/shared/constants'
import type { MiddlewareHandler } from 'hono'
import type { Logger } from './logging/index.js'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8'
}

export interface StaticOptions {
  root: string
  logger?: Logger
}

/**
 * Checks whether a resolved filesystem path is inside the given root directory.
 *
 * Uses `path.relative()` so the comparison is separator-agnostic on all platforms
 * (Windows backslashes, Unix forward slashes).
 */
function isInsideRoot(resolved: string, root: string): boolean {
  try {
    const rel = relative(root, resolved)
    // relative() returns '' for identity, or paths that start with '..' when outside root.
    return rel !== '' && !rel.startsWith('..')
  } catch {
    return false
  }
}

/**
 * Serves the built SPA from `root` (the Vite `dist/web` output).
 *
 * - `/api/*` and the health endpoint are passed through to the Hono router.
 * - Existing files are served with correct content types and immutable caching.
 * - SPA fallback: only browser navigation routes (no file extension) serve `index.html`.
 * - Requests for non-existent files with an extension return 404 (no SPA fallback).
 * - Path traversal is blocked: resolved paths must stay inside `root`.
 *
 * This keeps the frontend and API on the same origin (no CDN, no CORS).
 */
export function serveStatic(options: StaticOptions): MiddlewareHandler {
  const root = options.root
  const logger = options.logger
  return async (c, next) => {
    const url = new URL(c.req.url)
    let pathname = url.pathname

    // API and health endpoints are never served as static files.
    if (pathname.startsWith('/api') || pathname === HEALTH_PATH) {
      return next()
    }

    // Decode percent-encoded characters (e.g. %20 → space) and strip query string.
    try {
      pathname = decodeURIComponent(pathname)
    } catch {
      // Malformed percent-encoding — reject early.
      logger?.warn('Asset path rejected: malformed encoding', {
        event: 'static_asset',
        pathname: url.pathname
      })
      return c.json({ error: 'Bad request' }, 400)
    }

    // Map root path '/' to index.html.
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')

    // Resolve the candidate file path.
    const resolved = join(root, rel)

    // DIAGNOSTIC: remove after packaged-asset 404 root cause is proven.
    if (!existsSync(resolved) && rel.includes('.')) {
      console.error(`[rtwiki-static] miss rel=${rel} root=${root} resolved=${resolved}`)
    }

    // Path traversal check — the resolved path must stay inside root.
    if (!isInsideRoot(resolved, root)) {
      logger?.warn('Asset path rejected: path traversal', {
        event: 'static_asset',
        pathname
      })
      return c.json({ error: 'Forbidden' }, 403)
    }

    // Strip query string from resolved path for extension/exists checks.
    const resolvedNoQuery = resolved.split('?')[0]

    // Direct file serve: if the resolved path exists on disk, serve it exactly.
    if (existsSync(resolvedNoQuery)) {
      try {
        const file = Bun.file(resolvedNoQuery)
        const ext = resolvedNoQuery.slice(resolvedNoQuery.lastIndexOf('.'))
        const contentType = CONTENT_TYPES[ext] ?? file.type ?? 'application/octet-stream'
        const cacheControl = ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'

        return new Response(file, {
          headers: { 'content-type': contentType, 'cache-control': cacheControl }
        })
      } catch (err) {
        logger?.error('Unexpected static-serving failure', {
          event: 'static_asset',
          pathname,
          error: err instanceof Error ? err.message : String(err)
        })
        return c.json({ error: 'Internal server error' }, 500)
      }
    }

    // If the request has a file extension but the file does not exist, return 404.
    // This prevents assets like /assets/missing.js from falling back to index.html.
    if (rel.includes('.')) {
      logger?.warn('Static asset not found', {
        event: 'static_asset',
        pathname
      })
      return c.json({ error: 'Not found' }, 404)
    }

    // SPA fallback: only for browser navigation routes (no file extension).
    // Serve index.html for routes like /dashboard or /pages/abc123.
    logger?.info('SPA fallback to index.html', {
      event: 'static_fallback',
      pathname
    })

    const indexFile = join(root, 'index.html')
    if (existsSync(indexFile)) {
      const file = Bun.file(indexFile)
      return new Response(file, {
        headers: { 'content-type': CONTENT_TYPES['.html'], 'cache-control': 'no-cache' }
      })
    }

    // No index.html — fall through to Hono router's notFound.
    return next()
  }
}
