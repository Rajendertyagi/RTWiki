import {
  PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES,
  PROVISIONAL_MAX_IMAGE_PIXELS
} from '@rtwiki/shared/constants'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { acceptedDocumentFormatFor } from '../../shared/attachments/document-formats.js'
import { DOCUMENT_CSP_KEY } from '../app.js'
import type { getDb } from '../database/index.js'
import type { Logger } from '../logging/index.js'
import { isSameOrigin } from '../utils/request-origin.js'
import {
  type AttachmentKind,
  type AttachmentRecord,
  checksumOf,
  deleteAttachment,
  getAttachment,
  insertAttachment,
  normaliseOriginalName,
  streamAttachmentBytes
} from './attachment-repository.js'
import {
  contentDisposition,
  DOCUMENT_CONTENT_SECURITY_POLICY,
  DOCUMENT_VIEW_CONTENT_SECURITY_POLICY
} from './content-disposition.js'
import { inspectDocumentUpload } from './document-detect.js'
import { inspectImageUpload, pixelCount } from './image-detect.js'

export interface AttachmentRouteOptions {
  getDb: () => ReturnType<typeof getDb>
  logger: Logger
  /** Bounded by tests and by the default test instance. */
  available?: boolean
}

/** Why an upload was refused. */
type RejectionReason = 'empty' | 'unsupported_type' | 'svg_not_supported' | 'too_many_pixels'

/**
 * The message a rejection produces.
 *
 * Each reason gets its own words, because "unsupported" is not something a user
 * can act on. The mapping lives here so the code that refuses an upload and the
 * words the user reads cannot drift apart.
 */
const REJECTION_MESSAGES: Record<RejectionReason, { status: 400 | 413 | 415; error: string }> = {
  empty: { status: 400, error: 'That file is empty' },
  unsupported_type: {
    status: 415,
    error:
      'That file type is not supported. Try an image, a PDF, or a Word, PowerPoint, Excel, OpenDocument or RTF file.'
  },
  svg_not_supported: {
    status: 415,
    error: 'SVG images are not supported. Use a PNG, JPEG, GIF, WebP, AVIF or BMP file.'
  },
  too_many_pixels: {
    status: 415,
    error: `Image is larger than the ${PROVISIONAL_MAX_IMAGE_PIXELS / 1_000_000} megapixel limit.`
  }
}

/** What an accepted upload will be stored as, before the id and name are added. */
interface AcceptedUpload {
  mimeType: string
  kind: AttachmentKind
  /** Readable text, for the search index. Null for an image. */
  extractedText: string | null
  /** False when the file was identified from its reported type, not its bytes. */
  signatureless: boolean
}

/**
 * Upload, serving and removal for images and documents.
 *
 * Paths are relative to the `/api/attachments` mount, so the effective endpoints
 * are:
 *
 *   - `POST   /api/attachments`        - upload an image or a document
 *   - `GET    /api/attachments/:id`    - serve it, addressed by catalogue id
 *   - `GET    /api/attachments/:id/view` - serve a document inline, for the
 *                                          browser to draw in a new tab
 *   - `GET    /api/attachments/:id/text` - its extracted text
 *   - `DELETE /api/attachments/:id`    - remove the bytes and the metadata
 *
 * ## Why uploads are addressed by id
 *
 * The browser never names a file. `GET` takes an opaque id, looks it up, and
 * serves what the *server* stored. Since ADR-014 there is no path at all, so a
 * traversal attempt has nothing to traverse.
 *
 * ## Download and view are separate routes on purpose
 *
 * `GET /:id` is a forced download: a document is a program, so the default is
 * `Content-Disposition: attachment` and a per-response `default-src 'none';
 * sandbox` policy (ADR-015). `GET /:id/view` serves the same bytes inline, which
 * the owner authorised on 2026-09-27 (ADR-016).
 *
 * They are separate routes rather than one route with a parameter so the default
 * cannot become inline by accident, and so a test can assert the download
 * disposition without also asserting the view one. In both, Content-Disposition
 * is the control and the CSP is defence in depth.
 *
 * An image is unaffected by either: it is bytes the browser will draw, so it is
 * served inline from the download route with no disposition at all.
 */
/**
 * The context this route's own Hono instance carries.
 *
 * Declared here rather than imported from `app.ts` because that module mounts
 * these routes, and importing it back would be a cycle.
 */
interface AttachmentRouteVariables {
  [DOCUMENT_CSP_KEY]?: string
}

export function createAttachmentRoutes(opts: AttachmentRouteOptions) {
  const routes = new Hono<{ Variables: AttachmentRouteVariables }>()
  const { getDb, logger } = opts
  const available = opts.available ?? true

  // Applies the stricter document policy when a route asked for one.
  //
  // `app.ts` registers the equivalent override ahead of `secureHeaders`, and this
  // one makes the route correct on its own too — the route is mounted on a
  // separate Hono instance in tests, where the app-wide middleware does not exist
  // at all. Writing the header twice is harmless: the second write is the same
  // value.
  //
  // Without either, a PDF is served with the app-wide policy, `script-src 'self'`
  // included, because the document's own `default-src 'none'` was overwritten. That
  // was found by an end-to-end test against the compiled executable, not by any
  // unit test.
  routes.use('*', async (c, next) => {
    await next()
    const override = c.get(DOCUMENT_CSP_KEY)
    if (typeof override === 'string') c.header('Content-Security-Policy', override)
  })

  // Size is capped before the body is parsed, not after. Verified against both
  // an honest Content-Length request and a chunked stream with no length: both
  // are refused with 413, so an oversized upload never reaches memory.
  const limited = bodyLimit({
    maxSize: PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES,
    onError: (c) => c.json({ error: 'That file is too large' }, 413)
  })

  routes.post('/', limited, async (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403)
    if (!available) return c.json({ error: 'Attachments are unavailable' }, 503)

    const body = await c.req.parseBody()
    const file = body.file
    if (!(file instanceof File)) return c.json({ error: 'No file provided' }, 400)
    if (file.size === 0) return reject(c, 'empty', logger)

    // The whole file is read because it is stored whole, but every *decision*
    // about it is made from its own bytes. The declared type is consulted only
    // where the bytes cannot speak for themselves, and never for the stored type.
    const bytes = new Uint8Array(await file.arrayBuffer())
    const accepted = await acceptUpload(bytes, file.type)
    if (!accepted.ok) return reject(c, accepted.reason, logger)

    const id = crypto.randomUUID()
    const originalName = normaliseOriginalName(file.name)
    try {
      const record = insertAttachment(getDb(), {
        id,
        mimeType: accepted.upload.mimeType,
        byteSize: bytes.length,
        kind: accepted.upload.kind,
        extractedText: accepted.upload.extractedText,
        originalName,
        // Computed while the bytes are in hand: it is what makes content-addressed
        // deduplication possible later, and it is free now.
        checksum: checksumOf(bytes),
        data: bytes
      })
      return c.json({ attachment: toResponse(record) }, 201)
    } catch (err) {
      logger?.error('Attachment write failed', {
        event: 'attachment_write_failed',
        code: err instanceof Error ? err.name : 'unknown'
      })
      return c.json({ error: 'Could not store the file' }, 500)
    }
  })

  routes.get('/:id', async (c) => {
    if (!available) return c.json({ error: 'Attachments are unavailable' }, 503)
    const db = getDb()
    const id = c.req.param('id')
    const record = getAttachment(db, id)
    if (!record) return c.json({ error: 'Not found' }, 404)

    // A signature-less document has no servable bytes: what was stored is its
    // text, because those bytes could never be identified as a document.
    if (record.kind === 'document' && !isServableDocument(record.mimeType)) {
      return c.json({ error: 'Not found' }, 404)
    }

    // Streamed rather than read whole, so an in-flight response holds one chunk
    // instead of the entire file (ADR-014 §4).
    const stream = streamAttachmentBytes(db, id)
    if (!stream) return c.json({ error: 'Not found' }, 404)

    const headers: Record<string, string> = {
      'content-type': record.mimeType,
      // Stops a browser second-guessing the type and reinterpreting the bytes.
      'x-content-type-options': 'nosniff',
      // The file is addressed by id, so the cache key must be too: a shared cache
      // must never hand one attachment's bytes to another URL.
      'cache-control': 'private, no-cache',
      etag: `"${record.id}"`,
      // Declared from the stored length so the browser can show progress and
      // refuse a truncated file rather than saving half of it.
      'content-length': String(record.byteSize)
    }

    if (record.kind === 'document') {
      // Two independent layers, either of which alone would stop execution: the
      // disposition means the browser saves rather than renders, and the policy
      // means that even if it rendered, nothing in it could run.
      headers['content-disposition'] = contentDisposition(
        'attachment',
        record.originalName,
        acceptedDocumentFormatFor(record.mimeType)?.ext ?? 'bin'
      )
      // The policy is requested through the context rather than set here, because
      // the app-wide `secureHeaders` middleware runs after this handler and would
      // overwrite a header written here. See `DOCUMENT_CSP_KEY`.
      c.set(DOCUMENT_CSP_KEY, DOCUMENT_CONTENT_SECURITY_POLICY)
    }

    return new Response(stream, { headers })
  })

  /**
   * Serve a document **inline**, so the browser draws it in a new tab.
   *
   * A separate route from the download above, deliberately, so the two cannot be
   * confused: the default stays a forced download and inline serving is opt-in per
   * request. Authorised by the owner on 2026-09-27; see ADR-016, which supersedes
   * ADR-015 §3 and states the residual same-origin risk in full.
   *
   * ## Content-Disposition is the control, not the CSP
   *
   * `inline` is what permits rendering. The policy narrows what the document may
   * do once rendered; it is defence in depth, and it is not what makes the route
   * safe. The policy is the same `default-src 'none'; sandbox` the download route
   * sends, because it was measured that the viewer works under it — see
   * `DOCUMENT_VIEW_CONTENT_SECURITY_POLICY` for the measurement and its controls.
   */
  routes.get('/:id/view', async (c) => {
    if (!available) return c.json({ error: 'Attachments are unavailable' }, 503)
    const db = getDb()
    const id = c.req.param('id')
    const record = getAttachment(db, id)
    if (!record) return c.json({ error: 'Not found' }, 404)

    // Only a document may be rendered. An image is bytes the browser already
    // draws inline from the download route, so this route has nothing to add for
    // one, and refusing it keeps a single answer to "what can be rendered here".
    if (record.kind !== 'document') return c.json({ error: 'Not a document' }, 400)
    // A signature-less document has no servable bytes: what was stored is its text,
    // because those bytes could never be identified as a document.
    if (!isServableDocument(record.mimeType)) return c.json({ error: 'Not found' }, 404)

    // Streamed, for the same reason and with the same chunking as the download
    // route: an in-flight response holds one chunk, not the whole file.
    const stream = streamAttachmentBytes(db, id)
    if (!stream) return c.json({ error: 'Not found' }, 404)

    // The type is the recorded one, decided from the bytes at upload. Nothing in
    // this handler reads a client-supplied type, and nothing here can make an
    // unverified file renderable: a renamed PDF is still `application/pdf`, and an
    // unrecognised file never became a row.
    const headers: Record<string, string> = {
      'content-type': record.mimeType,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-cache',
      etag: `"${record.id}"`,
      'content-length': String(record.byteSize),
      'content-disposition': contentDisposition(
        'inline',
        record.originalName,
        acceptedDocumentFormatFor(record.mimeType)?.ext ?? 'bin'
      )
    }

    // Requested through the context for the same reason as the download route: the
    // app-wide `secureHeaders` middleware runs after this handler and would
    // overwrite a header written here. Narrower than the app-wide policy, and
    // applied to this response only — `app.ts` is not modified.
    c.set(DOCUMENT_CSP_KEY, DOCUMENT_VIEW_CONTENT_SECURITY_POLICY)

    return new Response(stream, { headers })
  })

  routes.get('/:id/text', (c) => {
    if (!available) return c.json({ error: 'Attachments are unavailable' }, 503)
    const record = getAttachment(getDb(), c.req.param('id'))
    if (!record) return c.json({ error: 'Not found' }, 404)
    // Returned as JSON text, never as markup, so a document's contents can never
    // become a rendering surface.
    return c.json({ text: record.extractedText ?? '', kind: record.kind })
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

/**
 * Decides what an upload is, or why it cannot be stored.
 *
 * Documents are identified first, and that ordering is deliberate. The document
 * parser recognises a real container; a file it does not recognise is either an
 * image or one of the formats that carry no signature at all. Checking the image
 * list first would mean a document never reached the parser, and checking the
 * reported type first would mean a renamed PDF could be taken for a renamed
 * `.txt`. The parser runs first precisely so the bytes outrank the claim.
 */
async function acceptUpload(
  bytes: Uint8Array,
  reportedType: string
): Promise<{ ok: true; upload: AcceptedUpload } | { ok: false; reason: RejectionReason }> {
  const document = await inspectDocumentUpload(bytes, reportedType)
  if (document.ok) {
    return {
      ok: true,
      upload: {
        mimeType: document.format.mime,
        kind: 'document',
        extractedText: document.text,
        signatureless: document.format.signatureless
      }
    }
  }

  const image = await inspectImageUpload(bytes)
  if (!image.ok) {
    // An SVG is named as such, because "unsupported type" would leave a user who
    // pasted a diagram with nothing to act on.
    return { ok: false, reason: image.reason }
  }

  // The pixel ceiling lives here rather than inside the detector, so that "what
  // is this" and "is this too big to open" stay separable questions. An unknown
  // size is allowed through: refusing a file whose header could not be read
  // would make an accepted format depend on a second parser agreeing.
  const pixels = pixelCount(image.width, image.height)
  if (pixels !== null && pixels > PROVISIONAL_MAX_IMAGE_PIXELS) {
    return { ok: false, reason: 'too_many_pixels' }
  }

  return {
    ok: true,
    upload: {
      mimeType: image.format.mime,
      kind: 'image',
      extractedText: null,
      signatureless: false
    }
  }
}

/** Whether a document's bytes may be handed back to a browser. */
function isServableDocument(mimeType: string): boolean {
  const format = acceptedDocumentFormatFor(mimeType)
  return format !== null && !format.signatureless
}

function reject(
  c: { json: (body: unknown, status?: number) => Response },
  reason: RejectionReason,
  logger: Logger
): Response {
  const message = REJECTION_MESSAGES[reason]
  logger?.warn('Attachment rejected', { event: 'attachment_rejected', code: reason })
  // The reason code travels beside the human-readable message so the client can
  // choose words the user can act on, without parsing English.
  return c.json({ error: message.error, code: reason }, message.status)
}

function toResponse(record: AttachmentRecord) {
  return {
    id: record.id,
    url: `/api/attachments/${record.id}`,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    kind: record.kind,
    /**
     * True when the file was identified from its reported type rather than its
     * bytes. The client uses it to explain that the text was imported instead.
     */
    signatureless:
      record.kind === 'document' &&
      acceptedDocumentFormatFor(record.mimeType)?.signatureless === true,
    originalName: record.originalName
  }
}
