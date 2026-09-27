import { z } from 'zod'

export const CreatePageSchema = z.object({
  title: z.string().min(1).max(200),
  pageType: z.enum(['rich', 'html', 'diagram', 'mindmap', 'markdown']).default('rich'),
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

export type CreatePageInput = z.infer<typeof CreatePageSchema>
export type UpdatePageInput = z.infer<typeof UpdatePageSchema>
