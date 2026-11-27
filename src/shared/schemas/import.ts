import { z } from 'zod'
import { PAGE_TYPES } from './pages.js'

/**
 * Every machine-readable code an import can return.
 *
 * One tuple shared by the server (which emits these) and the client (which maps
 * them to user-facing text). Keeping it here rather than in either consumer is
 * what stops a code being added on one side and silently falling through to a
 * generic error on the other.
 */
export const ImportErrorCode = [
  'wrong_media_type',
  'too_large',
  'forbidden',
  'no_file',
  'empty',
  'unsupported_source',
  'invalid_field',
  'text_too_long',
  'unsupported_type',
  'svg_not_supported',
  'too_many_pixels',
  'extract_failed',
  'legacy_office',
  'password_protected',
  'conversion_failed',
  'parent_not_found',
  'internal'
] as const

export type ImportErrorCode = (typeof ImportErrorCode)[number]

/** The only import source the foundation accepts. Paste and API are rejected. */
export const IMPORT_SOURCE_KINDS = ['file'] as const
export type ImportSourceKind = (typeof IMPORT_SOURCE_KINDS)[number]

/**
 * A source kind RTWiki recognises but deliberately refuses.
 *
 * Naming them explicitly (rather than letting the discriminated union emit a
 * generic `invalid_union`) is what makes the refusal report `unsupported_source`
 * instead of an unhelpful "invalid field" — the caller can tell the user that
 * this kind of import is not supported, which is the actionable answer.
 */
const UNSUPPORTED_SOURCE_KINDS = ['paste', 'api'] as const

const UnsupportedSourceSchema = z
  .object({ kind: z.enum(UNSUPPORTED_SOURCE_KINDS) })
  .check((ctx) => {
    ctx.issues.push({
      code: 'custom',
      input: ctx.value,
      message: 'This import source is not supported.',
      params: { code: 'unsupported_source' }
    })
  })

/**
 * The import source. `file` is the only accepted discriminator; `paste` and
 * `api` are recognised and refused with the `unsupported_source` code so the
 * reason is machine-readable rather than a generic union mismatch.
 */
export const ImportSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file') }),
  UnsupportedSourceSchema
])

export type ImportSource = z.infer<typeof ImportSourceSchema>

/**
 * The HTTP body for a structured import.
 *
 * Stage 1 defines the shape only; no route consumes it yet. The fields mirror
 * what the ingest core needs: the original file name (for the page title and
 * provenance), the browser-reported media type (a hint, never the authority),
 * an optional parent for the created page, and whether a page should be created
 * at all (attachment-only ingest sets that false).
 */
export const ImportRequestSchema = z.object({
  source: ImportSourceSchema,
  fileName: z.string().min(1),
  reportedType: z.string().optional(),
  parentId: z.string().uuid().nullable().optional(),
  createPage: z.boolean().default(true)
})

export type ImportRequest = z.infer<typeof ImportRequestSchema>

/**
 * One proposed page in an import preview. Deliberately carries no bytes and no
 * canonical content: the preview is a description of what *would* be created,
 * not a second copy of the document. The server keeps the prepared descriptor
 * (including bytes) in a process-local store keyed by `previewId`; the client
 * only ever sees this reduced, JSON-safe view.
 */
export const ImportPreviewPageSchema = z.object({
  title: z.string(),
  pageType: z.enum(PAGE_TYPES),
  byteSize: z.number().int().nonnegative(),
  originalName: z.string(),
  mimeType: z.string(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() }))
})

export type ImportPreviewPage = z.infer<typeof ImportPreviewPageSchema>

/** The response of `POST /api/import/preview`. */
export const ImportPreviewSchema = z.object({
  previewId: z.string().uuid(),
  pages: z.array(ImportPreviewPageSchema).min(1)
})

export type ImportPreview = z.infer<typeof ImportPreviewSchema>

/**
 * The body of `POST /api/import/confirm`. `parentId` is optional: when present it
 * overrides the parent captured at preview time for every prepared page; when
 * absent the preview's own value is used. `null` explicitly means "create at
 * root". The field reuses the create-page constraint so a confirm cannot place a
 * page somewhere the ordinary create route would refuse.
 */
export const ConfirmImportSchema = z.object({
  previewId: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional()
})

export type ConfirmImport = z.infer<typeof ConfirmImportSchema>

/**
 * Reads the machine-readable code from a zod failure, if one was attached.
 *
 * A `superRefine`/`check` issue carries its code under `params.code`; a plain
 * schema mismatch does not. Returning `null` for the latter lets a caller fall
 * back to `invalid_field` without guessing at issue shapes.
 */
export function importErrorCodeFromIssue(issue: z.core.$ZodIssue): ImportErrorCode | null {
  const code = (issue as { params?: { code?: unknown } }).params?.code
  return typeof code === 'string' && (ImportErrorCode as readonly string[]).includes(code)
    ? (code as ImportErrorCode)
    : null
}
