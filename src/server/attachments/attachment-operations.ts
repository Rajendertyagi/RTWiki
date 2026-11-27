import type { Database } from 'bun:sqlite'
import {
  type OperationKind,
  OperationKindSchema,
  type RecoveryActor,
  RecoveryActorSchema
} from '@rtwiki/shared/schemas/recovery'
import { insertOperationCore } from '../repositories/page-repository.js'

/**
 * The two actors attachment recovery writes with. Named here so no route or
 * sweep restates a literal from the shared `RecoveryActor` tuple; the schema
 * validator in `logAttachmentOperation` is the final gate on both.
 */
export const LOCAL_CLIENT_ACTOR: RecoveryActor = 'local-client'
export const SYSTEM_ACTOR: RecoveryActor = 'system'

/**
 * Records one committed attachment recovery operation inside the caller's
 * transaction. The kind and actor are validated against the shared tuples, so
 * a typo cannot write a value the recovery API would refuse to read back.
 *
 * Attachment operations carry no revision references: revisions describe page
 * states, and an attachment's bytes are their own snapshot. The chain rule in
 * `page-service.ts` therefore has nothing to link here.
 */
export function logAttachmentOperation(
  db: Database,
  kind: OperationKind,
  attachmentId: string,
  actor: RecoveryActor
): void {
  const parsedKind = OperationKindSchema.safeParse(kind)
  if (!parsedKind.success) throw new Error('Invalid attachment operation kind')
  const parsedActor = RecoveryActorSchema.safeParse(actor)
  if (!parsedActor.success) throw new Error('Invalid recovery actor')

  insertOperationCore(db, {
    id: crypto.randomUUID(),
    operationKind: parsedKind.data,
    targetPageId: null,
    targetAttachmentId: attachmentId,
    beforeRevisionId: null,
    afterRevisionId: null,
    actor: parsedActor.data,
    status: 'committed',
    createdAt: new Date().toISOString()
  })
}
