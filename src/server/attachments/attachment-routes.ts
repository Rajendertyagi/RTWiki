import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES } from '@rtwiki/shared/constants'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { getDb } from '../database/index.js'
import type { Logger } from '../logging/index.js'
import { isSameOrigin } from '../utils/request-origin.js'
import {
  type AttachmentRecord,
  deleteAttachment,
  getAttachment,
  insertAttachment,
  planStorage
} from './attachment-repository.js'

export interface AttachmentRouteOptions {
  /** Absolute path to `data/attachments` (ADR-005). */
  attachmentsDir: string
  getDb: () => ReturnType<typeof getDb>
  logger: Logger
  /** Bounded by tests and by the default test instance. */
  available?: boolean
}

/** A short, bounded reason code; never the uploader's text, never a stack. */
const REJECTED = 'unsupported_type' as const

/**
 * Image upload and serving. Paths are relative to the `/api/attachments` mount,
 * so the effective endpoints are:
 *
 *   - `POST /api/attachments` - multipart upload, validated by content
 *   - `GET  /api/attachments/:id` - serves the file, addressed by catalogue id
 *   - `DELETE /api/attachments/:id` - removes the row and the file
 *
 * ## Why uploads are addressed by id
 *
 * The browser never names a file. `GET` takes an opaque id, looks it up, and
 * serves the `stored_name` the *server* generated. A path traversal attempt has
 * nothing to traverse, because no part of the request reaches the filesystem
 * unmediated - which is stronger than sanitising a filename and checking the
 * result still resolves inside a directory.
 */
export function createAttachmentRoutes(opts: AttachmentRouteOptions) {
  const routes = new Hono()
  const { attachmentsDir, getDb, logger } = opts
  const available = opts.available ?? true

  // Size is capped before the body is parsed, not after: Hono's documented
  // `bodyLimit` middleware rejects on Content-Length and aborts the stream, so an
  // oversized upload never reaches memory. Checking `file.size` afterwards would
  // already have buffered it.
  const limited = bodyLimit({
    maxSize: PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES,
    onError: (c) => c.json({ error: 'Image is too large' }, 413)
  })

  routes.post('/', limited, async (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403)
    if (!available) return c.json({ error: 'Attachments are unavailable' }, 503)

    const body = await c.req.parseBody()
    const file = body.file
    if (!(file instanceof File)) return c.json({ error: 'No file provided' }, 400)
    if (file.size === 0) return c.json({ error: 'Image is empty' }, 400)

    // Read only as much as the signature needs plus a margin. The whole file is
    // read anyway to store it, but the decision is made on real bytes rather than
    // on the declared type.
    const bytes = new Uint8Array(await file.arrayBuffer())

    const id = crypto.randomUUID()
    const planned = planStorage(bytes, { id, originalName: file.name })
    if (!planned.ok) {
      logger?.warn('Attachment rejected', {
        event: 'attachment_rejected',
        code: REJECTED
      })
      return c.json({ error: 'Unsupported image type' }, 415)
    }

    // The generated name is the only path used. It cannot escape the directory
    // because it is a UUID and an extension we chose.
    const path = join(attachmentsDir, planned.record.storedName)
    try {
      // The bytes are already in memory, so Bun.write is the whole story. It
      // creates the file, writes, and closes; a partial file cannot be served
      // because the catalogue row is only inserted after this resolves.
      await Bun.write(path, bytes)
    } catch (err) {
      logger?.error('Attachment write failed', {
        event: 'attachment_write_failed',
        code: err instanceof Error ? err.name : 'unknown'
      })
      return c.json({ error: 'Could not store the image' }, 500)
    }

    const record = insertAttachment(getDb(), {
      id: planned.record.id,
      storedName: planned.record.storedName,
      mimeType: planned.record.mimeType,
      byteSize: planned.record.byteSize,
      originalName: planned.record.originalName,
      checksum: planned.record.checksum
    })
    return c.json({ attachment: toResponse(record) }, 201)
  })

  routes.get('/:id', async (c) => {
    if (!available) return c.json({ error: 'Attachments are unavailable' }, 503)
    const record = getAttachment(getDb(), c.req.param('id'))
    if (!record) return c.json({ error: 'Not found' }, 404)

    const file = Bun.file(join(attachmentsDir, record.storedName))
    if (!(await file.exists())) {
      // A row without its file is a broken state, not a 404 to retry: log it so
      // it is visible, and say plainly that the image is gone.
      logger?.error('Attachment file missing', {
        event: 'attachment_file_missing',
        targetId: record.id
      })
      return c.json({ error: 'Not found' }, 404)
    }

    return new Response(file, {
      headers: {
        // The type comes from our signature detection, never from the uploader.
        'content-type': record.mimeType,
        // Stops a browser second-guessing the type and reinterpreting the bytes.
        'x-content-type-options': 'nosniff',
        // The image is addressed by id, so the cache key must be too: a shared
        // cache must never hand one attachment's bytes to another URL.
        'cache-control': 'private, no-cache',
        etag: `"${record.id}"`
      }
    })
  })

  routes.delete('/:id', async (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403)
    if (!available) return c.json({ error: 'Attachments are unavailable' }, 503)
    const id = c.req.param('id')
    const record = getAttachment(getDb(), id)
    if (!record) return c.json({ error: 'Not found' }, 404)
    // The row goes first: a file with no row is an orphan that nothing can reach,
    // whereas a row pointing at a missing file is already reported by the GET
    // route and is harmless.
    if (!deleteAttachment(getDb(), id)) return c.json({ error: 'Not found' }, 404)
    try {
      await unlink(join(attachmentsDir, record.storedName))
    } catch {
      logger?.warn('Attachment file could not be removed', {
        event: 'attachment_delete_partial',
        targetId: id
      })
    }
    return c.json({ ok: true })
  })

  return routes
}

function toResponse(record: AttachmentRecord) {
  return {
    id: record.id,
    url: `/api/attachments/${record.id}`,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    originalName: record.originalName
  }
}
