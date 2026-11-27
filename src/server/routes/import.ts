import { PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES } from '@rtwiki/shared/constants'
import {
  type ImportErrorCode,
  ImportSourceSchema,
  importErrorCodeFromIssue
} from '@rtwiki/shared/schemas/import'
import { CreatePageSchema } from '@rtwiki/shared/schemas/pages'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { describeRoute } from 'hono-openapi'
import { z } from 'zod'
import { getAttachment } from '../attachments/attachment-repository.js'
import type { getDb } from '../database/index.js'
import { ingestFile } from '../ingest/ingest-file.js'
import type {
  IngestDependencies,
  IngestRejectionReason,
  IngestResult
} from '../ingest/ingest-types.js'
import { getImportSourceByPage } from '../ingest/provenance-repository.js'
import type { Logger } from '../logging/index.js'
import { AI_SAFE_TAG } from '../openapi/index.js'
import { getPage } from '../repositories/page-repository.js'
import { isSameOrigin } from '../utils/request-origin.js'

/**
 * `POST /api/import` — the full-ingest HTTP consumer of the one ingest pipeline
 * (ADR-024 §1). It owns no detection, storage or conversion logic: it validates
 * the multipart envelope, hands the bytes to `ingestFile`, and reads the three
 * records that the single transaction committed.
 *
 * The attachment route is the other consumer; both reach the same core so they
 * cannot drift apart. No CORS headers are emitted — cross-origin writes are
 * refused by the app-wide guard, not made legal by an `Access-Control-*` header.
 */

/** The source used when the client omits the optional `source` field. */
const DEFAULT_SOURCE_TEXT = '{"kind":"file"}'

/**
 * The ingest core does not currently use its logger, and this route has no
 * independent logging need. A no-op keeps the dependency explicit without
 * inventing a second logger; callers may inject a real one for future use.
 */
const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  async flush() {},
  async close() {}
}

/**
 * The text fields of the multipart body. Title and parent constraints are the
 * page service's own, reused rather than retyped so an import cannot create a
 * page the normal create route would refuse.
 */
const ImportFieldsSchema = z.object({
  title: CreatePageSchema.shape.title.optional(),
  parentId: CreatePageSchema.shape.parentId,
  source: z.string().optional()
})

/** Every ingest refusal has a machine-readable code shared with the client. */
const REASON_TO_CODE: Record<IngestRejectionReason, ImportErrorCode> = {
  no_file: 'no_file',
  empty: 'empty',
  unsupported_type: 'unsupported_type',
  svg_not_supported: 'svg_not_supported',
  too_many_pixels: 'too_many_pixels',
  extract_failed: 'extract_failed',
  legacy_office: 'legacy_office',
  password_protected: 'password_protected',
  unsupported_source: 'unsupported_source',
  invalid_field: 'invalid_field',
  text_too_long: 'text_too_long',
  conversion_failed: 'conversion_failed',
  parent_not_found: 'parent_not_found'
}

type SourceCheck = { ok: true } | { ok: false; error: string; code: ImportErrorCode }

/** Parses the optional JSON `source` field before any bytes are examined. */
function parseSource(text: string): SourceCheck {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'The import source must be valid JSON.', code: 'invalid_field' }
  }
  const parsed = ImportSourceSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error: issue?.message ?? 'The import source is invalid.',
      code: (issue ? importErrorCodeFromIssue(issue) : null) ?? 'invalid_field'
    }
  }
  // The schema's only successful variant is `{ kind: 'file' }`. `paste` and
  // `api` carry a custom issue and fail above with `unsupported_source`.
  return { ok: true }
}

export function createImportRoutes(
  getDbFn: () => ReturnType<typeof getDb>,
  overrides: Partial<IngestDependencies> = {}
): Hono {
  const routes = new Hono()
  const deps: IngestDependencies = { logger: noopLogger, ...overrides }

  // Size is capped before the body is parsed, exactly as on the attachment
  // route, so an oversized upload never reaches memory.
  const limited = bodyLimit({
    maxSize: PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES,
    onError: (c) => c.json({ error: 'That file is too large', code: 'too_large' }, 413)
  })

  routes.post(
    '/',
    describeRoute({
      tags: [AI_SAFE_TAG],
      summary: 'Import a file into a page',
      description:
        'Runs the one shared ingest pipeline: page, attachment and provenance in one transaction.',
      responses: {
        201: { description: 'Imported page and attachment' },
        415: { description: 'Unsupported file' }
      }
    }),
    limited,
    async (c) => {
      if (!isSameOrigin(c.req.raw)) return c.json({ error: 'Forbidden', code: 'forbidden' }, 403)

      const contentType = c.req.header('content-type') ?? ''
      if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
        return c.json(
          { error: 'This endpoint accepts a multipart file upload.', code: 'wrong_media_type' },
          415
        )
      }

      const body = await c.req.parseBody()
      const file = body.file
      if (!(file instanceof File)) {
        return c.json({ error: 'No file was provided.', code: 'no_file' }, 400)
      }

      const fields = ImportFieldsSchema.safeParse({
        title: body.title,
        parentId: body.parentId,
        source: body.source
      })
      if (!fields.success) {
        return c.json(
          { error: fields.error.issues[0]?.message ?? 'Invalid field', code: 'invalid_field' },
          400
        )
      }

      const source = parseSource(fields.data.source ?? DEFAULT_SOURCE_TEXT)
      if (!source.ok) return c.json({ error: source.error, code: source.code }, 400)

      const db = getDbFn()
      let result: IngestResult
      try {
        result = await ingestFile(
          db,
          {
            sourceKind: 'file',
            bytes: new Uint8Array(await file.arrayBuffer()),
            reportedType: file.type,
            originalName: file.name,
            title: fields.data.title,
            parentId: fields.data.parentId ?? null,
            createPage: true
          },
          deps
        )
      } catch {
        return c.json({ error: 'The import could not be completed.', code: 'internal' }, 500)
      }

      if (!result.ok) {
        return c.json({ error: result.message, code: REASON_TO_CODE[result.reason] }, result.status)
      }
      if (result.pageId === null) {
        return c.json({ error: 'The import did not create a page.', code: 'internal' }, 500)
      }

      // `ingestFile` has already COMMITted by the time it returns ok. These three
      // reads are diagnostics, not part of the write: a miss here cannot undo the
      // commit, and answering 500 would tell the client to retry and duplicate the
      // note. Return 201 with the ids the commit reported, log the gap, and let a
      // subsequent GET show the full records once they are readable again.
      const page = getPage(db, result.pageId)
      const attachment = getAttachment(db, result.attachmentId)
      const provenance = getImportSourceByPage(db, result.pageId)
      if (!page || !attachment || !provenance) {
        deps.logger.warn('Import readback incomplete after commit', {
          event: 'import_readback_incomplete',
          pageFound: page !== null,
          attachmentFound: attachment !== null,
          provenanceFound: provenance !== null
        })
      }

      return c.json(
        {
          page: page ?? { id: result.pageId },
          attachment: attachment ?? {
            id: result.attachmentId,
            mimeType: result.mimeType,
            byteSize: result.byteSize
          },
          provenance: provenance ?? {
            pageId: result.pageId,
            attachmentId: result.attachmentId,
            sourceKind: 'file',
            originalName: file.name
          },
          warnings: result.warnings
        },
        201
      )
    }
  )

  return routes
}
