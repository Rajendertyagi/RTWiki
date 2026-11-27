import type { Database } from 'bun:sqlite'
import {
  DEFAULT_IMPORTED_PAGE_TITLE,
  DOCUMENT_SIZE_WARNING_BYTES
} from '../../shared/constants/index.js'
import { markdownNoteTitle } from '../../shared/import/policy.js'
import { serializeMarkdownContent } from '../../shared/schemas/markdown-content.js'
import {
  checksumOf,
  insertAttachment,
  normaliseOriginalName
} from '../attachments/attachment-repository.js'
import { DOCUMENT_TEXT_MAX_CHARS } from '../attachments/document-detect.js'
import { createPageCore, HierarchyError } from '../services/page-service.js'
import type { DetectResult } from './detect-upload.js'
import { detectUpload } from './detect-upload.js'
import { documentToMarkdown, extractImages } from './document-to-markdown.js'
import type {
  CommitResult,
  CommittedImport,
  IngestDependencies,
  IngestFailure,
  IngestFileInput,
  IngestRejectionReason,
  IngestResult,
  IngestWarning,
  PreparedImport,
  PrepareResult
} from './ingest-types.js'
import { insertImportSource } from './provenance-repository.js'

/**
 * The one server-side ingest pipeline (ADR-024 §1).
 *
 * Detection and conversion are asynchronous and happen **before** the write
 * transaction opens. Everything inside `BEGIN IMMEDIATE` is synchronous, so the
 * page, its attachment and its provenance commit as one unit and a crash can
 * never leave a partial import observable.
 *
 * Phase 3 splits that single pipeline into two explicit stages without adding a
 * second one:
 *
 *   `prepareImport`  — validation, detection, conversion, descriptor building.
 *                      Pure with respect to the database; safe for a preview.
 *   `commit*`        — the original single transaction, replayed from the
 *                      descriptor. `ingestFile = prepare + commit`, so the
 *                      existing `POST /api/import` and attachment consumers are
 *                      byte-for-byte unchanged in behaviour.
 *
 * The preview/confirm routes reuse these same two stages. No detection or
 * conversion logic is duplicated there.
 */

type IngestStatus = 400 | 404 | 413 | 415 | 422

function reject(
  reason: IngestRejectionReason,
  status: IngestStatus,
  message: string
): IngestFailure {
  return { ok: false, reason, status, message }
}

function fromDetectFailure(failure: Extract<DetectResult, { ok: false }>): IngestFailure {
  switch (failure.reason) {
    case 'empty':
      return reject('empty', 400, 'That file is empty.')
    case 'unsupported_type':
      return reject('unsupported_type', 415, 'That file type is not supported.')
    case 'svg_not_supported':
      return reject('svg_not_supported', 415, 'SVG files are not supported.')
    case 'too_many_pixels':
      return reject('too_many_pixels', 413, 'That image has too many pixels.')
    case 'extract_failed':
      return reject('extract_failed', 422, 'That document could not be opened.')
    case 'legacy_office':
      return reject('legacy_office', 422, 'Save as .docx, .xlsx or .pptx and try again.')
    case 'password_protected':
      return reject('password_protected', 422, 'Remove the password and try again.')
  }
}

/**
 * Validates, detects and converts one file into a descriptor that is ready to
 * commit. This stage performs **no database reads or writes**, which is what
 * lets `POST /api/import/preview` run the real pipeline without creating
 * anything. Failure is always a structured value, never a thrown error.
 */
export async function prepareImport(
  input: IngestFileInput,
  deps: IngestDependencies
): Promise<PrepareResult> {
  // Source validation comes first: paste and API sources are refused before a
  // single byte is examined (ADR-023 security gate).
  if (input.sourceKind !== 'file') {
    return reject('unsupported_source', 400, 'This import source is not supported.')
  }
  // Defensive: the HTTP layer rejects a missing file before it reaches here, but
  // the core must not hand a null to the detector if called directly.
  if (!input.bytes) {
    return reject('no_file', 400, 'No file was provided.')
  }
  if (input.bytes.length === 0) {
    return reject('empty', 400, 'That file is empty.')
  }
  if (input.originalName.trim().length === 0) {
    return reject('invalid_field', 400, 'A file name is required.')
  }

  // All asynchronous work happens before the write lock is taken.
  const detected = await detectUpload(input.bytes, input.reportedType, {
    limits: deps.limits,
    maxImagePixels: deps.maxImagePixels
  })
  if (!detected.ok) return fromDetectFailure(detected)

  // Signature-less text is returned untruncated by detection. On the page path,
  // refuse an over-limit file rather than silently dropping its tail: losing
  // content during import is forbidden (AGENTS.md §4). On the attachment path
  // the full bytes are stored (D1-A), so only the search-index text is capped
  // and nothing is lost — accept it as before.
  if (input.createPage && detected.kind === 'text' && detected.truncated) {
    return reject(
      'text_too_long',
      413,
      `This note's text is longer than the ${DOCUMENT_TEXT_MAX_CHARS.toLocaleString('en-US')} character limit. Split it into smaller notes, or import it as a file attachment instead.`
    )
  }

  // Conversion is only needed when a page is created. Detection already
  // produces the search text for the attachment (documents via `searchText`,
  // signature-less files via flattened raw text), so the attachment-only path
  // skips the `ast.to('md')` cost entirely. That path is also the one Stage 3
  // uses for every upload, including images — and an image has no Markdown to
  // produce, so calling the converter there would wrongly reject it.
  //
  // For documents, officeparser extracted embedded images at parse time. Give
  // each one an id now (synchronously, before the write lock) so the Markdown
  // generator can render real RTWiki URLs through `onNode`, and the images can
  // be stored under those ids inside the same transaction as the page.
  const imageExtraction =
    input.createPage && detected.kind === 'document' ? extractImages(detected.ast) : null
  const imageIds = new Map<string, string>()
  if (imageExtraction) {
    for (const image of imageExtraction.images) {
      imageIds.set(image.name, crypto.randomUUID())
    }
  }
  let unresolvedImages = 0
  const converted = input.createPage
    ? await documentToMarkdown(detected, {
        imageUrlResolver: (name) => {
          const id = imageIds.get(name)
          return id ? `/api/attachments/${id}` : null
        },
        // A name the resolver cannot map is an image we failed to bring across.
        // Count it so the warning is emitted even when the library reported no
        // loss of its own — never degrade silently (AGENTS.md §4).
        onUnresolvedImage: () => {
          unresolvedImages++
        },
        skippedImages: () => (imageExtraction?.skipped ?? 0) + unresolvedImages
      })
    : null
  if (converted !== null && !converted.ok) {
    return reject('conversion_failed', 422, converted.message)
  }

  const warnings: IngestWarning[] = []
  if (converted?.ok) {
    // Conversion-only warnings (skipped images, empty extraction) belong to the
    // page path; an attachment-only ingest has no conversion to report on.
    warnings.push(...converted.warnings)
  }
  // The size warning is about the stored bytes, not the conversion, so it applies
  // to the attachment route too. It used to be nested under `converted?.ok`, which
  // silently dropped it for every `createPage: false` upload — the exact path the
  // attachment route takes.
  if (
    detected.kind === 'document' &&
    input.bytes.length > (deps.documentSizeWarningBytes ?? DOCUMENT_SIZE_WARNING_BYTES)
  ) {
    warnings.push({
      code: 'document_size_warning',
      message: 'This document is large. It was added, but it may be slow to open and search.'
    })
  }

  const attachmentId = crypto.randomUUID()
  const pageId = input.createPage ? crypto.randomUUID() : null
  const originalName = normaliseOriginalName(input.originalName) ?? 'import'
  const checksum = checksumOf(input.bytes)
  const extractedText =
    detected.kind === 'document'
      ? detected.searchText
      : detected.kind === 'text'
        ? detected.rawText.replace(/\s+/g, ' ').trim().slice(0, DOCUMENT_TEXT_MAX_CHARS)
        : null

  const images: Array<{
    id: string
    mimeType: string
    byteSize: number
    originalName: string
    checksum: string
    data: Uint8Array
  }> = []
  if (imageExtraction) {
    for (const image of imageExtraction.images) {
      const id = imageIds.get(image.name)
      if (!id) throw new Error('Invariant: extracted image without an id')
      images.push({
        id,
        mimeType: image.mimeType,
        byteSize: image.bytes.length,
        originalName: image.name,
        checksum: checksumOf(image.bytes),
        data: image.bytes
      })
    }
  }

  return {
    ok: true,
    attachment: {
      id: attachmentId,
      mimeType: detected.format.mime,
      byteSize: input.bytes.length,
      kind: detected.kind === 'image' ? 'image' : 'document',
      extractedText,
      originalName,
      checksum,
      data: input.bytes
    },
    page:
      pageId !== null && converted?.ok
        ? {
            id: pageId,
            title:
              (input.title ?? markdownNoteTitle(input.originalName)) || DEFAULT_IMPORTED_PAGE_TITLE,
            pageType: 'markdown',
            content: serializeMarkdownContent({ version: 1, markdown: converted.markdown }),
            parentId: input.parentId ?? null
          }
        : null,
    images,
    provenance:
      pageId !== null
        ? {
            id: crypto.randomUUID(),
            sourceKind: 'file',
            originalName,
            byteSize: input.bytes.length,
            checksum,
            mimeType: detected.format.mime
          }
        : null,
    warnings,
    mimeType: detected.format.mime,
    byteSize: input.bytes.length
  }
}

/**
 * Writes one prepared import inside the caller's transaction. No `BEGIN` here:
 * the single and batch commit wrappers own the lock so a multi-page confirm can
 * commit every item as one unit. Throws on failure so the caller rolls back.
 */
function commitPreparedImportCore(db: Database, prepared: PreparedImport): CommittedImport {
  // D1-A: the original bytes are ALWAYS stored, including for signature-less
  // files. ADR-023 reversed ADR-015 §7 for the ingest path so an imported text
  // file is downloadable like every other document.
  insertAttachment(db, {
    id: prepared.attachment.id,
    mimeType: prepared.attachment.mimeType,
    byteSize: prepared.attachment.byteSize,
    kind: prepared.attachment.kind,
    extractedText: prepared.attachment.extractedText,
    originalName: prepared.attachment.originalName,
    checksum: prepared.attachment.checksum,
    data: prepared.attachment.data
  })

  if (prepared.page !== null) {
    // Conversion runs exactly when createPage is true, which is the only case
    // that sets pageId. Fail loudly rather than store a page-less import if
    // that invariant is ever broken.
    if (prepared.provenance === null) {
      throw new Error('Invariant: page requested without a provenance descriptor')
    }

    // Store every extracted image under the id the Markdown already references.
    // This is inside the same transaction: a failed image write rolls back the
    // page, so the note can never link to an attachment that does not exist.
    for (const image of prepared.images) {
      insertAttachment(db, {
        id: image.id,
        mimeType: image.mimeType,
        byteSize: image.byteSize,
        kind: 'image',
        extractedText: null,
        originalName: image.originalName,
        checksum: image.checksum,
        data: image.data
      })
    }

    createPageCore(db, prepared.page.id, {
      title: prepared.page.title,
      pageType: prepared.page.pageType,
      content: prepared.page.content,
      parentId: prepared.page.parentId
    })
    insertImportSource(db, {
      id: prepared.provenance.id,
      pageId: prepared.page.id,
      attachmentId: prepared.attachment.id,
      sourceKind: prepared.provenance.sourceKind,
      originalName: prepared.provenance.originalName,
      byteSize: prepared.provenance.byteSize,
      checksum: prepared.provenance.checksum,
      mimeType: prepared.provenance.mimeType
    })
  }

  return {
    pageId: prepared.page?.id ?? null,
    attachmentId: prepared.attachment.id,
    mimeType: prepared.mimeType,
    byteSize: prepared.byteSize,
    warnings: prepared.warnings
  }
}

/** Commits one prepared import in a single transaction (the original path). */
export function commitPreparedImport(db: Database, prepared: PreparedImport): IngestResult {
  db.run('BEGIN IMMEDIATE')
  try {
    const committed = commitPreparedImportCore(db, prepared)
    db.run('COMMIT')
    return {
      ok: true,
      attachmentId: committed.attachmentId,
      pageId: committed.pageId,
      mimeType: committed.mimeType,
      byteSize: committed.byteSize,
      warnings: committed.warnings
    }
  } catch (err) {
    db.run('ROLLBACK')
    if (err instanceof HierarchyError) {
      return reject('parent_not_found', 404, 'Parent page not found')
    }
    throw err
  }
}

/**
 * Commits every prepared import in ONE transaction. This is the confirm path:
 * it reuses `createPageCore` (the same core `createPagesBatch` loops over) plus
 * the existing `insertAttachment`/`insertImportSource` helpers, so a failure in
 * any item rolls the whole set back and no partial import is ever observable.
 */
export function commitPreparedImports(
  db: Database,
  prepareds: readonly PreparedImport[]
): CommitResult {
  db.run('BEGIN IMMEDIATE')
  try {
    const committed = prepareds.map((prepared) => commitPreparedImportCore(db, prepared))
    db.run('COMMIT')
    return { ok: true, committed }
  } catch (err) {
    db.run('ROLLBACK')
    if (err instanceof HierarchyError) {
      return reject('parent_not_found', 404, 'Parent page not found')
    }
    throw err
  }
}

/**
 * Ingests one file: prepare, then store bytes + page + provenance in a single
 * transaction. Failure is always a structured value, never a thrown error, so
 * an HTTP consumer can map it to a status without guessing.
 */
export async function ingestFile(
  db: Database,
  input: IngestFileInput,
  deps: IngestDependencies
): Promise<IngestResult> {
  const prepared = await prepareImport(input, deps)
  if (!prepared.ok) return prepared
  return commitPreparedImport(db, prepared)
}
