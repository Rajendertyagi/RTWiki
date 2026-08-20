import type { MiddlewareHandler } from 'hono'
import { existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { HEALTH_PATH } from '@rtwiki/shared/constants'

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
}

/**
 * Serves the built SPA from `root` (the Vite `dist/web` output).
 *
 * - `/api/*` and the health endpoint are passed through to the Hono router.
 * - Existing files are served with correct content types and immutable caching.
 * - Any other path falls back to `index.html` (SPA client-side routing).
 * - Path traversal is blocked: resolved paths must stay inside `root`.
 *
 * This keeps the frontend and API on the same origin (no CDN, no CORS).
 */
export function serveStatic(options: StaticOptions): MiddlewareHandler {
  const root = normalize(options.root)
  return async (c, next) => {
    const url = new URL(c.req.url)
    const pathname = url.pathname

    if (pathname.startsWith('/api') || pathname === HEALTH_PATH) {
      return next()
    }

    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const resolved = normalize(join(root, rel))
    const withinRoot = resolved === root || resolved.startsWith(`${root}/`)

    if (withinRoot && existsSync(resolved)) {
      const file = Bun.file(resolved)
      const ext = resolved.slice(resolved.lastIndexOf('.'))
      const contentType = CONTENT_TYPES[ext] ?? file.type ?? 'application/octet-stream'
      const cacheControl = ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
      return new Response(file, {
        headers: { 'content-type': contentType, 'cache-control': cacheControl }
      })
    }

    // SPA fallback: serve index.html for unknown non-API routes.
    const indexFile = join(root, 'index.html')
    if (existsSync(indexFile)) {
      const file = Bun.file(indexFile)
      return new Response(file, {
        headers: { 'content-type': CONTENT_TYPES['.html'], 'cache-control': 'no-cache' }
      })
    }

    return next()
  }
}
