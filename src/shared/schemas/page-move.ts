import { z } from 'zod'
import type { PageType } from '../contracts/pages'

/**
 * Payload for `POST /api/pages/:id/move`.
 *
 * `newPosition` is the final zero-based index of the moved page among its
 * destination siblings **after** the page has been removed from its origin
 * sibling list. Values beyond the destination end clamp to the last slot;
 * negative or non-integer values are rejected.
 */
export const PageMoveSchema = z.object({
  newParentId: z.string().uuid().nullable(),
  newPosition: z.number().int().min(0)
})

export type PageMoveInput = z.infer<typeof PageMoveSchema>

export interface MoveReconciliationResponse {
  page: {
    id: string
    title: string
    pageType: PageType
    parentId: string | null
    position: number
    updatedAt: string
    version: number
  }
  originParentId: string | null
  originSiblings: Array<{ id: string; position: number }>
  destinationParentId: string | null
  destinationSiblings: Array<{ id: string; position: number }>
}
