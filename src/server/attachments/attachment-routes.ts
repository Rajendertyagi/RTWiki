import {
  PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES,
  PROVISIONAL_MAX_IMAGE_PIXELS
} from '@rtwiki/shared/constants'
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
  planStorage,
  type StoredAttachment,
  streamAttachmentBytes
} from './attachment-repository.js'
import { inspectImageUpload, pixelCount } from './image-detect.js'

export interface AttachmentRouteOptions {
  getDb: () => ReturnType<typeof getDb>
  logger: Logger
  /** Bounded by tests and by the default test instance. */
  available?: boolean
}

/**
 * The message a rejection produces.
 *
 * Each reason gets its own words because a user who pastes an SVG deserves to
 * learn that SVG is the problem, not that "something" is. The mapping lives here
 * so the code that refuses an upload and the words the user reads cannot drift.
 */
const REJECTION_MESSAGES: Record<
  Exclude<StoredAttachment, { ok: true }>['reason'],
  { status: 400 | 413 | 415; error: string }
> = {
  empty: { status: 400, error: 'Image is empty' },
  unsupported_type: { status: 415, error: 'Unsupported image type' },
  svg_not_supported: {
    status: 415,
    error: 'SVG images are not supported. Use a PNG, JPEG, GIF, WebP, AVIF or BMP file.'
  },
  too_many_pixels: {
    status: 415,
    error: `Image is larger than the ${PROVISIONAL_MAX_IMAGE_PIXELS / 1_000_000} megapixel limit.`
  }
}

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
  const { getDb, logger } = opts
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

    // The whole file is read because it is stored whole, but every *decision*
    // about it is made from its own bytes: the type comes from the file's
    // container structure, and the dimensions from its header. The declared
    // type is never read.
    const bytes = new Uint8Array(await file.arrayBuffer())

    const id = crypto.randomUUID()
    const inspection = await inspectImageUpload(bytes)

    // The pixel ceiling is applied here rather than inside the detector so that
    // detection and the limit stay separable: detection answers "what is this",
    // the limit answers "is this too big to open". An unknown size is allowed
    // through, because refusing a file whose header we could not parse would
    // mean an accepted format depending on a second parser agreeing.
    const pixels = inspection.ok ? pixelCount(inspection.width, inspection.height) : null
    const planned: StoredAttachment =
      inspection.ok && pixels !== null && pixels > PROVISIONAL_MAX_IMAGE_PIXELS
        ? { ok: false, reason: 'too_many_pixels' }
        : planStorage(bytes, { id, originalName: file.name, inspection })

    if (!planned.ok) {
      const message = REJECTION_MESSAGES[planned.reason]
      logger?.warn('Attachment rejected', {
        event: 'attachment_rejected',
        code: planned.reason
      })
      // The reason code travels beside the human-readable message so the client
      // can give an actionable message for the cases a user can fix, without
      // parsing English.
      return c.json({ error: message.error, code: planned.reason }, message.status)
    }

    // One statement writes the bytes and their metadata together, so an
    // attachment can never exist as one without the other (ADR-014).
    let record: AttachmentRecord
    try {
      record = insertAttachment(getDb(), { ...planned.record, data: bytes })
    } catch (err) {
      logger?.error('Attachment write failed', {
        event: 'attachment_write_failed',
        code: err instanceof Error ? err.name : 'unknown'
      })
      return c.json({ error: 'Could not store the image' }, 500)
    }

    return c.json({ attachment: toResponse(record) }, 201)
  })

  routes.get('/:id', async (c) => {
    if (!available) return c.json({ error: 'Attachments are unavailable' }, 503)
    const id = c.req.param('id')
    const record = getAttachment(getDb(), id)
    if (!record) return c.json({ error: 'Not found' }, 404)

    // Streamed rather than read whole, so an in-flight response holds one chunk
    // instead of the entire image (ADR-014 §4).
    const stream = streamAttachmentBytes(getDb(), id)
    if (!stream) return c.json({ error: 'Not found' }, 404)

    return new Response(stream, {
      headers: {
        // The type comes from our detection of the file's own structure, never
        // from the uploader.
        'content-type': record.mimeType,
        // Stops a browser second-guessing the type and reinterpreting the bytes.
        'x-content-type-options': 'nosniff',
        // The image is addressed by id, so the cache key must be too: a shared
        // cache must never hand one attachment's bytes to another URL.
        'cache-control': 'private, no-cache',
        etag: `"${record.id}"`,
        // Declared from the stored length so the browser can lay the image out
        // before the last chunk arrives.
        'content-length': String(record.byteSize)
      }
    })
  })

  routes.delete('/:id', async (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403)
    if (!available) return c.json({ error: 'Attachments are unavailable' }, 503)
    const id = c.req.param('id')
    if (!getAttachment(getDb(), id)) return c.json({ error: 'Not found' }, 404)
    // One statement removes the bytes and their metadata together. There is no
    // second step that can fail and leave the two disagreeing.
    if (!deleteAttachment(getDb(), id)) return c.json({ error: 'Not found' }, 404)
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
