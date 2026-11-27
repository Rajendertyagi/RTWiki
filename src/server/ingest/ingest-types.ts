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
  | IngestFailure

/** The shared failure shape of every ingest stage. */
export interface IngestFailure {
  readonly ok: false
  readonly reason: IngestRejectionReason
  readonly status: 400 | 404 | 413 | 415 | 422
  readonly message: string
}

/**
 * A fully prepared, not-yet-committed import. Detection and conversion have
 * already run; every value the write transaction needs is present, including
 * the original bytes. Nothing here touches the database, so a preview can build
 * one without creating a page, attachment, provenance row or search row.
 *
 * IDs are allocated during preparation (not during commit) so provenance can
 * reference the exact page id inside the same transaction, exactly as the
 * original single-file ingest did.
 */
export interface PreparedImport {
  /** The primary attachment: the uploaded file's verbatim bytes. */
  readonly attachment: {
    readonly id: string
    readonly mimeType: string
    readonly byteSize: number
    readonly kind: 'image' | 'document'
    readonly extractedText: string | null
    readonly originalName: string
    readonly checksum: string
    readonly data: Uint8Array
  }
  /** The page to create, or null for an attachment-only ingest. */
  readonly page: {
    readonly id: string
    readonly title: string
    readonly pageType: 'markdown'
    readonly content: string
    readonly parentId: string | null
  } | null
  /** Images extracted from a document, stored under the ids the Markdown uses. */
  readonly images: readonly {
    readonly id: string
    readonly mimeType: string
    readonly byteSize: number
    readonly originalName: string
    readonly checksum: string
    readonly data: Uint8Array
  }[]
  /** The provenance snapshot, present exactly when a page is created. */
  readonly provenance: {
    readonly id: string
    readonly sourceKind: 'file'
    readonly originalName: string
    readonly byteSize: number
    readonly checksum: string
    readonly mimeType: string
  } | null
  readonly warnings: readonly IngestWarning[]
  readonly mimeType: string
  readonly byteSize: number
}

/** `prepareImport` either yields a descriptor or a structured refusal. */
export type PrepareResult = ({ readonly ok: true } & PreparedImport) | IngestFailure

/** One committed item, reported by the multi-page confirm path. */
export interface CommittedImport {
  readonly pageId: string | null
  readonly attachmentId: string
  readonly mimeType: string
  readonly byteSize: number
  readonly warnings: readonly IngestWarning[]
}

/** `commitPreparedImports` commits every prepared item or none of them. */
export type CommitResult =
  | { readonly ok: true; readonly committed: readonly CommittedImport[] }
  | IngestFailure

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
