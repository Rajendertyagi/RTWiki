import { z } from 'zod'

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  app: z.string(),
  version: z.string(),
  db: z.object({
    ready: z.boolean()
  }),
  time: z.string()
})

export type HealthResponseInput = z.infer<typeof HealthResponseSchema>
