import { z } from 'zod'

export const PageTypeSchema = z.enum(['rich', 'html'])

export const CreatePageSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  pageType: PageTypeSchema.default('rich'),
  content: z.string().default('')
})

export const UpdatePageSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  content: z.string().optional(),
  pageType: PageTypeSchema.optional()
})

export type CreatePageInput = z.infer<typeof CreatePageSchema>
export type UpdatePageInput = z.infer<typeof UpdatePageSchema>
