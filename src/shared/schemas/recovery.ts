import { z } from 'zod'

/**
 * The closed value sets written by the recovery subsystem.
 *
 * One tuple per concern, shared by the server (which writes these strings to
 * SQLite), the routes and the UI. Keeping them here rather than in any one
 * consumer is what stops a value being added on one side and silently failing
 * validation on the other. The tuples are the single source of truth; the Zod
 * schemas and the derived union types below are all derived from them.
 *
 * These are recovery operations only -- not a general activity log. Do not add
 * values for ordinary reads, edits, settings writes or other events.
 */

/** The only operations recorded in `operation_log`. Exactly eight, no others. */
export const OperationKind = [
  'page.update',
  'page.trash',
  'page.restore',
  'page.revision.restore',
  'page.permanent_delete',
  'attachment.trash',
  'attachment.restore',
  'attachment.permanent_delete'
] as const
export type OperationKind = (typeof OperationKind)[number]

/** A log row exists only for a committed operation; there is no pending state. */
export const OperationStatus = ['committed'] as const
export type OperationStatus = (typeof OperationStatus)[number]

/** Who initiated a recovery operation or captured a revision. */
export const RecoveryActor = ['local-client', 'system', 'ai'] as const
export type RecoveryActor = (typeof RecoveryActor)[number]

/**
 * When a revision was captured. These are the three capture points that exist
 * today: before an update, before a soft delete, and before a restore. There is
 * no import-overwrite path (`POST /api/import` only creates pages), so there is
 * deliberately no `before_import` value.
 */
export const RevisionCaptureKind = [
  'before_update',
  'before_soft_delete',
  'before_restore'
] as const
export type RevisionCaptureKind = (typeof RevisionCaptureKind)[number]

/** Validators for service boundaries; derived from the tuples above. */
export const OperationKindSchema = z.enum(OperationKind)
export const OperationStatusSchema = z.enum(OperationStatus)
export const RecoveryActorSchema = z.enum(RecoveryActor)
export const RevisionCaptureKindSchema = z.enum(RevisionCaptureKind)
