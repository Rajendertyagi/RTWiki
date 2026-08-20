import { z } from 'zod'

export const CreatePageSchema = z.object({
  title: z.string().min(1).max(200),
  pageType: z.enum(['rich', 'html']).default('rich'),
  content: z.string().default(''),
})

export const UpdatePageSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  pageType: z.enum(['rich', 'html']).optional(),
})

export type CreatePageInput = z.infer<typeof CreatePageSchema>
export type UpdatePageInput = z.infer<typeof UpdatePageSchema>