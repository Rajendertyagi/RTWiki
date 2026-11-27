import {
  IMPORT_PREVIEW_MAX_FILES_PER_PREVIEW,
  PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES
} from '@rtwiki/shared/constants'
import {
  ConfirmImportSchema,
  type ImportErrorCode,
  type ImportPreview,
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
import { commitPreparedImports, ingestFile, prepareImport } from '../ingest/ingest-file.js'
import type {
  IngestDependencies,
  IngestRejectionReason,
  IngestResult,
  PreparedImport
} from '../ingest/ingest-types.js'
import { createPreviewStore, type PreviewStore } from '../ingest/preview-store.js'
import { getImportSourceByPage } from '../ingest/provenance-repository.js'
import type { Logger } from '../logging/index.js'
import { AI_SAFE_TAG, MULTIPART_FILE_REQUEST_BODY } from '../openapi/index.js'
import { getPage } from '../repositories/page-repository.js'
import { readJson } from '../utils/read-json.js'
import { isSameOrigin } from '../utils/request-origin.js'

/**
 * `POST /api/import` — the full-ingest HTTP consumer of the one ingest pipeline
 * (ADR-024 §1). It owns no detection, storage or conversion logic: it validates
 * the multipart envelope, hands the bytes to `ingestFile`, and reads the three
 * records that the single transaction committed.
 *
 * Phase 3 adds two more consumers of the *same* core:
 *
 * - `POST /api/import/preview` runs `prepareImport` only — no database access at
 *   all — and keeps the prepared descriptor in a process-local store.
 * - `POST /api/import/confirm` consumes that descriptor and replays it through
 *   `commitPreparedImports`, which uses `createPageCore` and the existing
 *   attachment/provenance helpers in one transaction.
 *
 * No CORS headers are emitted — cross-origin writes are refused by the app-wide
 * guard, not made legal by an `Access-Control-*` header.
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

/** First string value of a multipart field parsed with `{ all: true }`. */
function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const first = value[0]
    return typeof first === 'string' ? first : undefined
  }
  return undefined
}

/** All `File` values under the `file` key, in submission order. */
function filesFrom(value: unknown): File[] {
  if (value instanceof File) return [value]
  if (Array.isArray(value)) return value.filter((item): item is File => item instanceof File)
  return []
}

export function createImportRoutes(
  getDbFn: () => ReturnType<typeof getDb>,
  overrides: Partial<IngestDependencies> = {},
  previewStore: PreviewStore = createPreviewStore()
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
      requestBody: MULTIPART_FILE_REQUEST_BODY,
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

  /**
   * Preview runs the real detection/conversion stage but never opens the
   * database. The prepared descriptors (including bytes) are held in the
   * process-local store; the response is a JSON-safe description of the pages
   * that a confirm would create. Untagged on purpose: a new orchestration route
   * is not exposed to the AI tool surface until explicitly authorised (§7.1).
   */
  routes.post('/preview', limited, async (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: 'Forbidden', code: 'forbidden' }, 403)

    const contentType = c.req.header('content-type') ?? ''
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      return c.json(
        { error: 'This endpoint accepts a multipart file upload.', code: 'wrong_media_type' },
        415
      )
    }

    const body = await c.req.parseBody({ all: true })
    const files = filesFrom(body.file)
    if (files.length === 0) {
      return c.json({ error: 'No file was provided.', code: 'no_file' }, 400)
    }

    const fields = ImportFieldsSchema.safeParse({
      title: firstString(body.title),
      parentId: firstString(body.parentId),
      source: firstString(body.source)
    })
    if (!fields.success) {
      return c.json(
        { error: fields.error.issues[0]?.message ?? 'Invalid field', code: 'invalid_field' },
        400
      )
    }

    const source = parseSource(fields.data.source ?? DEFAULT_SOURCE_TEXT)
    if (!source.ok) return c.json({ error: source.error, code: source.code }, 400)

    const prepareds: PreparedImport[] = []
    for (const file of files) {
      const prepared = await prepareImport(
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
      if (!prepared.ok) {
        return c.json(
          { error: prepared.message, code: REASON_TO_CODE[prepared.reason] },
          prepared.status
        )
      }
      prepareds.push(prepared)
    }

    const previewId = previewStore.store(prepareds)
    if (previewId === null) {
      return c.json(
        {
          error: `A preview may contain at most ${IMPORT_PREVIEW_MAX_FILES_PER_PREVIEW} files.`,
          code: 'invalid_field'
        },
        400
      )
    }
    const preview: ImportPreview = {
      previewId,
      pages: prepareds.map((prepared) => ({
        title: prepared.page?.title ?? prepared.attachment.originalName,
        pageType: prepared.page?.pageType ?? 'markdown',
        byteSize: prepared.byteSize,
        originalName: prepared.attachment.originalName,
        mimeType: prepared.mimeType,
        warnings: prepared.warnings.map((warning) => ({
          code: warning.code,
          message: warning.message
        }))
      }))
    }
    return c.json(preview, 200)
  })

  /**
   * Releases a preview the client cancelled. Untagged like preview and confirm:
   * a new orchestration route is not part of the AI tool surface. Idempotent —
   * an unknown or already-consumed id is a successful no-op — and it makes no
   * database writes of any kind. The bytes stop being retained immediately
   * instead of waiting for the preview to expire.
   */
  routes.delete('/preview/:id', (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: 'Forbidden', code: 'forbidden' }, 403)
    previewStore.discard(c.req.param('id'))
    return c.json({ ok: true })
  })

  /**
   * Confirm consumes a preview and commits every prepared page in ONE
   * transaction. The descriptor is revalidated with the same Zod schemas the
   * ordinary create route uses before any write, and an optional `parentId`
   * overrides the one captured at preview (documented in `ConfirmImportSchema`).
   * Untagged for the same reason as preview.
   */
  routes.post('/confirm', async (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: 'Forbidden', code: 'forbidden' }, 403)

    const read = await readJson(c)
    if (!read.ok) return read.response
    const parsed = ConfirmImportSchema.safeParse(read.body)
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid field', code: 'invalid_field' },
        400
      )
    }

    // Consumed on read: a second confirm cannot duplicate the pages. If the
    // commit fails the client previews again; no partial state survives.
    const prepareds = previewStore.take(parsed.data.previewId)
    if (prepareds === null) {
      return c.json(
        { error: 'This preview has expired. Preview the file again.', code: 'invalid_field' },
        400
      )
    }

    // Revalidate the server-produced descriptor with the existing page schema.
    // This is defence in depth: a descriptor that somehow drifted out of shape
    // is refused before the transaction opens, not half-written inside it.
    for (const prepared of prepareds) {
      if (prepared.page === null) continue
      const check = CreatePageSchema.safeParse({
        title: prepared.page.title,
        pageType: prepared.page.pageType,
        content: prepared.page.content,
        parentId: prepared.page.parentId
      })
      if (!check.success) {
        return c.json(
          { error: check.error.issues[0]?.message ?? 'Invalid field', code: 'invalid_field' },
          400
        )
      }
    }

    // An explicit parentId at confirm overrides the preview's value for every
    // page; omitting it keeps the preview's value. `null` means root.
    const override = parsed.data.parentId
    const toCommit =
      override === undefined
        ? prepareds
        : prepareds.map((prepared) =>
            prepared.page === null
              ? prepared
              : { ...prepared, page: { ...prepared.page, parentId: override } }
          )

    const db = getDbFn()
    let result: ReturnType<typeof commitPreparedImports>
    try {
      result = commitPreparedImports(db, toCommit)
    } catch {
      return c.json({ error: 'The import could not be completed.', code: 'internal' }, 500)
    }
    if (!result.ok) {
      return c.json({ error: result.message, code: REASON_TO_CODE[result.reason] }, result.status)
    }

    // Readback is diagnostic, as on the single-file route: the commit already
    // succeeded, so a miss here must not turn a successful import into a 500
    // that invites a duplicate retry.
    const pages = result.committed.flatMap((item) => {
      if (item.pageId === null) return []
      const page = getPage(db, item.pageId)
      return page === null ? [] : [page]
    })
    const warnings = result.committed.flatMap((item) => item.warnings)
    return c.json({ pages, warnings }, 201)
  })

  return routes
}
