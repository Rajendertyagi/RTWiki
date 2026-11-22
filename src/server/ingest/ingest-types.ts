import type { ImportSourceKind } from '../../shared/schemas/import.js'
import type { DocumentResourceLimits } from '../attachments/document-detect.js'
import type { Logger } from '../logging/index.js'

/** The only import source the ingest core accepts. */
export type { ImportSourceKind }

/** A file handed to the ingest core. Bytes are already in memory. */
export interface IngestFileInput {
  /** Must be `'file'`; paste and API sources are rejected before bytes are read. */
  readonly sourceKind: ImportSourceKind
  /** The original bytes. Stored verbatim, including for signature-less files (D1-A). */
  readonly bytes: Uint8Array
  /** Browser-reported media type. A hint for signature-less formats only. */
  readonly reportedType?: string | null
  /** Original file name, used for the page title and provenance snapshot. */
  readonly originalName: string
  /**
   * Explicit page title. When omitted, derived from `originalName` by the shared
   * policy so the HTTP layer and any direct caller agree on the default.
   */
  readonly title?: string
  /** Optional parent for the created page. Validated inside the write transaction. */
  readonly parentId?: string | null
  /** False for attachment-only ingest; true also creates a page and provenance. */
  readonly createPage: boolean
}

/** Things the user should know that did not stop the import. */
export interface IngestWarning {
  readonly code:
    | 'images_not_imported'
    | 'document_size_warning'
    | 'empty_extraction'
    | 'parts_not_read'
  readonly message: string
}

/** Why an import was refused. */
export type IngestRejectionReason =
  | 'no_file'
  | 'empty'
  | 'unsupported_type'
  | 'svg_not_supported'
  | 'too_many_pixels'
  | 'extract_failed'
  | 'legacy_office'
  | 'password_protected'
  | 'unsupported_source'
  | 'invalid_field'
  | 'text_too_long'
  | 'conversion_failed'
  | 'parent_not_found'

/** The outcome of an ingest. Failure is a value, never a thrown error. */
export type IngestResult =
  | {
      readonly ok: true
      readonly attachmentId: string
      readonly pageId: string | null
      readonly mimeType: string
      readonly byteSize: number
      readonly warnings: readonly IngestWarning[]
    }
  | {
      readonly ok: false
      readonly reason: IngestRejectionReason
      readonly status: 400 | 404 | 413 | 415 | 422
      readonly message: string
    }

/** Explicit dependencies. No hidden globals, per the development standards. */
export interface IngestDependencies {
  readonly logger: Logger
  /** Advisory document-size threshold. Defaults to the shared constant. */
  readonly documentSizeWarningBytes?: number
  /** Resource ceilings for a document parse. Defaults to the production limits. */
  readonly limits?: Readonly<DocumentResourceLimits>
  /** Pixel ceiling for an image. Defaults to the shared constant. */
  readonly maxImagePixels?: number
}
