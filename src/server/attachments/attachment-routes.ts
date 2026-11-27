import {
  DOCUMENT_SIZE_WARNING_BYTES,
  PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES,
  PROVISIONAL_MAX_IMAGE_PIXELS
} from '@rtwiki/shared/constants'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { describeRoute } from 'hono-openapi'
import { acceptedDocumentFormatFor } from '../../shared/attachments/document-formats.js'
import { DOCUMENT_CSP_KEY } from '../app.js'
import type { getDb } from '../database/index.js'
import { ingestFile } from '../ingest/ingest-file.js'
import type { IngestRejectionReason, IngestResult } from '../ingest/ingest-types.js'
import type { Logger } from '../logging/index.js'
import { AI_SAFE_TAG, MULTIPART_FILE_REQUEST_BODY } from '../openapi/index.js'
import { reindexPagesReferencingAttachment } from '../services/page-service.js'
import { isSameOrigin } from '../utils/request-origin.js'
import { LOCAL_CLIENT_ACTOR, logAttachmentOperation } from './attachment-operations.js'
import {
  type AttachmentRecord,
  deleteAttachment,
  getAttachment,
  listAttachments,
  restoreAttachment,
  softDeleteAttachment,
  streamAttachmentBytes
} from './attachment-repository.js'
import {
  contentDisposition,
  DOCUMENT_CONTENT_SECURITY_POLICY,
  DOCUMENT_VIEW_CONTENT_SECURITY_POLICY
} from './content-disposition.js'

export interface AttachmentRouteOptions {
  getDb: () => ReturnType<typeof getDb>
  logger: Logger
  /** Bounded by tests and by the default test instance. */
  available?: boolean
  /**
   * Advisory warning threshold for documents. Defaults to the shared constant;
   * overridable so a test can exercise the warning without a 50 MB fixture.
   */
  documentSizeWarningBytes?: number
}

/** The user-facing warning for a large-but-accepted document. */
export const DOCUMENT_SIZE_WARNING_MESSAGE =
  'This document is large. It was added, but it may be slow to open and search.'

/** Why an upload was refused. */
type RejectionReason =
  | 'empty'
  | 'unsupported_type'
  | 'svg_not_supported'
  | 'too_many_pixels'
  /**
   * A container RTWiki recognised and then could not open — either it expands past the
   * decompression ceiling, or it is truncated or malformed.
   *
   * Distinct from `unsupported_type`, which would tell a user their perfectly valid DOCX
   * is a file type this application does not accept. It gets its own words because the two
   * problems have different causes, and a user who hits this one has a different thing to
   * do about it.
   */
  | 'extract_failed'
  /** An old .doc/.xls/.ppt file: the user can fix this by saving in a modern format. */
  | 'legacy_office'
  /** An encrypted modern Office file: the user can fix this by removing the password. */
  | 'password_protected'

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
  },
  extract_failed: {
    status: 415,
    // Deliberately does not name a byte figure. The condition is reached either by a
    // document that expands far beyond what arrived, or by a damaged one, and a message
    // quoting a limit would be wrong for the second case — a 4 KB file is not "too large".
    // Both are fixed by opening the file and saving it again.
    error:
      'That document could not be opened. It may be damaged, or too large to read — try opening it and saving a fresh copy.'
  },
  legacy_office: {
    status: 415,
    // Old OLE/CFB Office files are recognised but not accepted. Unlike a generic
    // "unsupported type", this tells the user exactly how to make the file usable.
    error: 'Save as .docx, .xlsx or .pptx and try again.'
  },
  password_protected: {
    status: 415,
    // Encrypted modern Office files are also CFB, but telling these users to
    // "save as .docx" would be wrong — the file already is one.
    error: 'This file is password-protected. Remove the password and try again.'
  }
}

/**
 * The ingest reasons that have a stable attachment-route answer.
 *
 * `ingestFile` reports a few reasons this route has never had words for, and uses
 * different statuses for four of the ones it does (422/413 where this route has
 * always answered 415). Mapping through `REJECTION_MESSAGES` keeps the response
 * contract — status, `error` and `code` — exactly as it was before ingest was
 * centralised. Reasons outside this table cannot occur in attachment-only mode
 * and are answered with a generic 400 rather than echoed to the client.
 */
const INGEST_REJECTION_MAP: Partial<Record<IngestRejectionReason, RejectionReason>> = {
  empty: 'empty',
  unsupported_type: 'unsupported_type',
  svg_not_supported: 'svg_not_supported',
  too_many_pixels: 'too_many_pixels',
  extract_failed: 'extract_failed',
  legacy_office: 'legacy_office',
  password_protected: 'password_protected'
}

/**
 * Upload, serving and removal for images and documents.
 *
 * Paths are relative to the `/api/attachments` mount, so the effective endpoints
 * are:
 *
 *   - `POST   /api/attachments`        - upload an image or a document
 *   - `GET    /api/attachments/trash`  - list soft-deleted attachments only
 *   - `GET    /api/attachments/:id`    - serve it, addressed by catalogue id
 *   - `GET    /api/attachments/:id/view` - serve a document inline, for the
 *                                          browser to draw in a new tab
 *   - `GET    /api/attachments/:id/text` - its extracted text
 *   - `DELETE /api/attachments/:id`    - move it to the trash, keeping the bytes
 *   - `POST   /api/attachments/:id/restore` - return it to the living set
 *   - `DELETE /api/attachments/:id/permanent?confirm=permanent` - purge it
 *
 * Every ordinary read uses the repository's default `living` visibility, so a
 * trashed attachment is invisible by id and absent from search. Only the trash
 * endpoints opt in to `trashed` rows.
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
  const warningBytes = opts.documentSizeWarningBytes ?? DOCUMENT_SIZE_WARNING_BYTES

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

  routes.post(
    '/',
    describeRoute({
      tags: [AI_SAFE_TAG],
      summary: 'Upload an attachment',
      description: 'Stores an image or document through the single shared ingest pipeline.',
      requestBody: MULTIPART_FILE_REQUEST_BODY,
      responses: {
        201: { description: 'Stored attachment' },
        415: { description: 'Unsupported file' }
      }
    }),
    limited,
    async (c) => {
      if (!isSameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403)
      if (!available) return c.json({ error: 'Attachments are unavailable' }, 503)

      const body = await c.req.parseBody()
      const file = body.file
      if (!(file instanceof File)) return c.json({ error: 'No file provided' }, 400)
      if (file.size === 0) return reject(c, 'empty', logger)

      // The whole file is read because it is stored whole, but every *decision*
      // about it is made from its own bytes. Detection, byte storage and warnings
      // all live in the one ingest pipeline (ADR-024 §1); this route only maps the
      // result onto the response it has always returned.
      const bytes = new Uint8Array(await file.arrayBuffer())
      const db = getDb()
      let result: IngestResult
      try {
        result = await ingestFile(
          db,
          {
            sourceKind: 'file',
            bytes,
            reportedType: file.type,
            originalName: file.name,
            createPage: false
          },
          { logger, documentSizeWarningBytes: warningBytes }
        )
      } catch (err) {
        logger?.error('Attachment write failed', {
          event: 'attachment_write_failed',
          code: err instanceof Error ? err.name : 'unknown'
        })
        return c.json({ error: 'Could not store the file' }, 500)
      }
      if (!result.ok) return rejectIngest(c, result, logger)

      // A large document is still accepted — this is advisory, not a limit. The
      // warning is produced by ingest for both the page and attachment paths; keep
      // the operator log here and surface the first warning in the response, which
      // has always carried a single `warning` object.
      if (result.warnings.some((w) => w.code === 'document_size_warning')) {
        logger.warn('Large document accepted', {
          event: 'document_size_warning',
          bytes: bytes.length
        })
      }

      const record = getAttachment(db, result.attachmentId)
      if (!record) return c.json({ error: 'Could not store the file' }, 500)
      const warning = result.warnings[0]
      return c.json(
        {
          attachment: toResponse(record),
          ...(warning ? { warning: { code: warning.code, message: warning.message } } : {})
        },
        201
      )
    }
  )

  /**
   * The trash contains ONLY soft-deleted rows. Registered before `/:id` so the
   * literal `trash` cannot be swallowed as an attachment id.
   */
  routes.get('/trash', (c) => {
    if (!available) return c.json({ error: 'Attachments are unavailable' }, 503)
    const attachments = listAttachments(getDb(), 'trashed')
    return c.json({
      attachments: attachments.map(toResponse),
      total: attachments.length
    })
  })

  routes.get(
    '/:id',
    describeRoute({
      tags: [AI_SAFE_TAG],
      summary: 'Download an attachment by id',
      description: 'Returns the stored bytes. Documents are forced downloads with a blocking CSP.',
      responses: { 200: { description: 'Attachment bytes' }, 404: { description: 'Not found' } }
    }),
    async (c) => {
      if (!available) return c.json({ error: 'Attachments are unavailable' }, 503)
      const db = getDb()
      const id = c.req.param('id')
      // Default visibility is `living`: a trashed attachment is not downloadable
      // by its normal id, and its bytes are never streamed.
      const record = getAttachment(db, id)
      if (!record) return c.json({ error: 'Not found' }, 404)

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
    }
  )

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
    const record = getAttachment(db, id, 'living')
    if (!record) return c.json({ error: 'Not found' }, 404)

    // Only a document may be rendered. An image is bytes the browser already
    // draws inline from the download route, so this route has nothing to add for
    // one, and refusing it keeps a single answer to "what can be rendered here".
    if (record.kind !== 'document') return c.json({ error: 'Not a document' }, 400)
    // Signature-less bytes are now stored (ADR-023), but they are deliberately
    // not renderable inline: the type was never established from the bytes, so
    // this route stays a defence-in-depth refusal even though the download route
    // serves the same bytes as a forced attachment.
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

  routes.get(
    '/:id/text',
    describeRoute({
      tags: [AI_SAFE_TAG],
      summary: 'Read an attachment’s extracted text',
      description: 'Returns extracted text as JSON, never as markup.',
      responses: { 200: { description: 'Extracted text' }, 404: { description: 'Not found' } }
    }),
    (c) => {
      if (!available) return c.json({ error: 'Attachments are unavailable' }, 503)
      const record = getAttachment(getDb(), c.req.param('id'), 'living')
      if (!record) return c.json({ error: 'Not found' }, 404)
      // Returned as JSON text, never as markup, so a document's contents can never
      // become a rendering surface.
      return c.json({ text: record.extractedText ?? '', kind: record.kind })
    }
  )

  /**
   * Soft delete. The bytes and every metadata column stay; only `deleted_at`
   * changes. The mutation and its operation-log row share one transaction, so
   * the trash can never contain an attachment the log does not know about.
   */
  routes.delete('/:id', async (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403)
    if (!available) return c.json({ error: 'Attachments are unavailable' }, 503)
    const db = getDb()
    const id = c.req.param('id')
    if (!getAttachment(db, id, 'living')) return c.json({ error: 'Not found' }, 404)

    db.run('BEGIN IMMEDIATE')
    try {
      if (!softDeleteAttachment(db, id)) {
        db.run('ROLLBACK')
        return c.json({ error: 'Not found' }, 404)
      }
      logAttachmentOperation(db, 'attachment.trash', id, LOCAL_CLIENT_ACTOR)
      db.run('COMMIT')
    } catch (err) {
      db.run('ROLLBACK')
      throw err
    }

    // The document's text was indexed against every page that referenced it, and
    // those pages still hold its URL. Now that the row is trashed, the shared
    // extractor omits its text; reindex so stale words stop being findable. This
    // is best-effort: the trash transition is already committed, and the worst
    // case is stale search text, not a wrong result.
    reindexAfterTrashChange(db, id, logger)
    return c.json({ ok: true })
  })

  /** Restores a trashed attachment to the living set, atomically with its log row. */
  routes.post('/:id/restore', async (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403)
    if (!available) return c.json({ error: 'Attachments are unavailable' }, 503)
    const db = getDb()
    const id = c.req.param('id')
    if (!getAttachment(db, id, 'trashed')) return c.json({ error: 'Not found' }, 404)

    db.run('BEGIN IMMEDIATE')
    try {
      if (!restoreAttachment(db, id)) {
        db.run('ROLLBACK')
        return c.json({ error: 'Not found' }, 404)
      }
      logAttachmentOperation(db, 'attachment.restore', id, LOCAL_CLIENT_ACTOR)
      db.run('COMMIT')
    } catch (err) {
      db.run('ROLLBACK')
      throw err
    }

    // The attachment is living again, so its extracted text belongs back in the
    // search rows of every page whose content still references it.
    reindexAfterTrashChange(db, id, logger)
    const restored = getAttachment(db, id, 'living')
    if (!restored) return c.json({ error: 'Not found' }, 404)
    return c.json({ attachment: toResponse(restored) })
  })

  /**
   * Irreversible purge. The query parameter is a deliberate speed bump, not a
   * security boundary; the origin guard above is the real gate. Row and BLOB go
   * in one statement, with the log row in the same transaction.
   */
  routes.delete('/:id/permanent', async (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403)
    if (!available) return c.json({ error: 'Attachments are unavailable' }, 503)
    if (c.req.query('confirm') !== 'permanent') {
      return c.json({ error: 'Confirmation required', code: 'confirmation_required' }, 400)
    }
    const db = getDb()
    const id = c.req.param('id')
    if (!getAttachment(db, id, 'any')) return c.json({ error: 'Not found' }, 404)

    db.run('BEGIN IMMEDIATE')
    try {
      if (!deleteAttachment(db, id)) {
        db.run('ROLLBACK')
        return c.json({ error: 'Not found' }, 404)
      }
      logAttachmentOperation(db, 'attachment.permanent_delete', id, LOCAL_CLIENT_ACTOR)
      db.run('COMMIT')
    } catch (err) {
      db.run('ROLLBACK')
      throw err
    }
    return c.json({ ok: true })
  })

  return routes
}

/**
 * Recomputes the search rows of pages that referenced an attachment whose trash
 * state just changed. Kept in one place so the soft-delete and restore routes
 * cannot disagree about when text is indexed.
 */
function reindexAfterTrashChange(db: ReturnType<typeof getDb>, id: string, logger: Logger): void {
  try {
    reindexPagesReferencingAttachment(db, id)
  } catch (err) {
    logger?.warn('Attachment reindex failed', {
      event: 'attachment_reindex_failed',
      code: err instanceof Error ? err.name : 'unknown'
    })
  }
}

/**
 * Maps an ingest refusal onto the answer this route has always returned.
 *
 * Ingest owns detection and reports a wider set of reasons, with different
 * statuses for four of them (422/413 where this route has always answered 415).
 * Only reasons with an established `REJECTION_MESSAGES` entry get their existing
 * words, status and code. Everything else is either impossible in attachment-only
 * mode or an internal failure, and is answered with a safe generic 400 rather
 * than echoing an internal reason to the client.
 */
function rejectIngest(
  c: { json: (body: unknown, status?: number) => Response },
  result: Extract<IngestResult, { ok: false }>,
  logger: Logger
): Response {
  // Keep the operator's container-refusal log. Ingest collapses the detector's
  // detail into a user-facing message, so the reason is the most precise code
  // available at this boundary.
  if (result.reason === 'extract_failed') {
    logger?.warn('Document container refused', {
      event: 'document_refused',
      code: result.reason
    })
  }
  const mapped = INGEST_REJECTION_MAP[result.reason]
  if (mapped) return reject(c, mapped, logger)
  logger?.warn('Attachment ingest rejected', {
    event: 'attachment_rejected',
    code: result.reason
  })
  return c.json({ error: 'That file could not be added', code: 'invalid_field' }, 400)
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
    originalName: record.originalName,
    /** Null for a living attachment; set only for rows returned by the trash list. */
    deletedAt: record.deletedAt
  }
}
