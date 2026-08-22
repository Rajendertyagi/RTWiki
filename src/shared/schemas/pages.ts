import { z } from 'zod'

export const CreatePageSchema = z.object({
  title: z.string().min(1).max(200),
  pageType: z.enum(['rich', 'html']).default('rich'),
  content: z.string().default('')
})

/**
 * Page-type conversion is not supported in Phase 4A: `pageType` is
 * deliberately absent so an update can never change a stored type. The route
 * layer additionally rejects requests that carry the field, giving clients an
 * explicit error instead of silent stripping.
 */
export const UpdatePageSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional()
})

export type CreatePageInput = z.infer<typeof CreatePageSchema>
export type UpdatePageInput = z.infer<typeof UpdatePageSchema>
