import { z } from 'zod'

/**
 * The four canonical page types, defined once. `CreatePageSchema` and the import
 * preview descriptor both derive from this tuple, so a new type cannot be added
 * to one without the other (AGENTS.md §5 — one source of truth).
 *
 * `mindmap` is deliberately absent: migration 010 rewrites any surviving row to
 * `diagram`, so a row that still holds it is a corrupted database and is
 * rejected rather than silently coerced.
 */
export const PAGE_TYPES = ['rich', 'html', 'diagram', 'markdown'] as const

export const CreatePageSchema = z.object({
  title: z.string().min(1).max(200),
  pageType: z.enum(PAGE_TYPES).default('rich'),
  content: z.string().default(''),
  // Optional parent: omitted/NULL creates a root page. Validated against a
  // living parent inside the creation transaction.
  parentId: z.string().uuid().nullable().optional()
})

/**
 * Page-type conversion is not supported in Phase 4A: `pageType` is
 * deliberately absent so an update can never change a stored type. The route
 * layer additionally rejects requests that carry the field, giving clients an
 * explicit error instead of silent stripping.
 *
 * Hierarchy changes are equally out of scope for PATCH: `parentId` is absent
 * here and the route layer rejects any request that carries it — moves happen
 * only through `POST /api/pages/:id/move`.
 *
 * `version` is the writer's optimistic-lock token: the page version it last
 * read. It is REQUIRED and never defaulted. An update is applied only when the
 * stored version still equals it, so a writer that read the page earlier (a
 * second tab or window) is rejected with 409 instead of silently overwriting a
 * newer save. Omitting it must be a validation error, never a wildcard.
 */
export const UpdatePageSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  version: z
    .number({ error: 'A page version is required: reload the page and try again' })
    .int()
    .min(1)
})

/**
 * Payload for `POST /api/pages/batch`. Each item is validated with the very
 * same `CreatePageSchema` the single-page endpoint uses, so a batch can never
 * accept a shape the ordinary create would reject. The byte ceiling on the
 * request body is the existing page-route ceiling, not a new count limit.
 */
export const BatchCreatePagesSchema = z.object({
  pages: z.array(CreatePageSchema).min(1)
})

export type BatchCreatePagesInput = z.infer<typeof BatchCreatePagesSchema>
export type CreatePageInput = z.infer<typeof CreatePageSchema>
export type UpdatePageInput = z.infer<typeof UpdatePageSchema>
