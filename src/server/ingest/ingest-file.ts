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
  IngestDependencies,
  IngestFileInput,
  IngestRejectionReason,
  IngestResult,
  IngestWarning
} from './ingest-types.js'
import { insertImportSource } from './provenance-repository.js'

/**
 * The one server-side ingest pipeline (ADR-024 §1).
 *
 * Detection and conversion are asynchronous and happen **before** the write
 * transaction opens. Everything inside `BEGIN IMMEDIATE` is synchronous, so the
 * page, its attachment and its provenance commit as one unit and a crash can
 * never leave a partial import observable.
 */

type IngestStatus = 400 | 404 | 413 | 415 | 422

function reject(
  reason: IngestRejectionReason,
  status: IngestStatus,
  message: string
): IngestResult {
  return { ok: false, reason, status, message }
}

function fromDetectFailure(failure: Extract<DetectResult, { ok: false }>): IngestResult {
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
 * Ingests one file: detect, convert, then store bytes + page + provenance in a
 * single transaction. Failure is always a structured value, never a thrown
 * error, so an HTTP consumer can map it to a status without guessing.
 */
export async function ingestFile(
  db: Database,
  input: IngestFileInput,
  deps: IngestDependencies
): Promise<IngestResult> {
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

  db.run('BEGIN IMMEDIATE')
  try {
    // D1-A: the original bytes are ALWAYS stored, including for signature-less
    // files. ADR-023 reversed ADR-015 §7 for the ingest path so an imported text
    // file is downloadable like every other document.
    insertAttachment(db, {
      id: attachmentId,
      mimeType: detected.format.mime,
      byteSize: input.bytes.length,
      kind: detected.kind === 'image' ? 'image' : 'document',
      extractedText,
      originalName,
      checksum,
      data: input.bytes
    })

    if (pageId !== null) {
      // Conversion runs exactly when createPage is true, which is the only case
      // that sets pageId. Fail loudly rather than store a page-less import if
      // that invariant is ever broken.
      if (!converted?.ok) throw new Error('Invariant: page requested without a conversion result')

      // Store every extracted image under the id the Markdown already references.
      // This is inside the same transaction: a failed image write rolls back the
      // page, so the note can never link to an attachment that does not exist.
      if (imageExtraction) {
        for (const image of imageExtraction.images) {
          const id = imageIds.get(image.name)
          if (!id) throw new Error('Invariant: extracted image without an id')
          insertAttachment(db, {
            id,
            mimeType: image.mimeType,
            byteSize: image.bytes.length,
            kind: 'image',
            extractedText: null,
            originalName: image.name,
            checksum: checksumOf(image.bytes),
            data: image.bytes
          })
        }
      }

      createPageCore(db, pageId, {
        title:
          (input.title ?? markdownNoteTitle(input.originalName)) || DEFAULT_IMPORTED_PAGE_TITLE,
        pageType: 'markdown',
        content: serializeMarkdownContent({ version: 1, markdown: converted.markdown }),
        parentId: input.parentId ?? null
      })
      insertImportSource(db, {
        id: crypto.randomUUID(),
        pageId,
        attachmentId,
        sourceKind: 'file',
        originalName,
        byteSize: input.bytes.length,
        checksum,
        mimeType: detected.format.mime
      })
    }

    db.run('COMMIT')
    return {
      ok: true,
      attachmentId,
      pageId,
      mimeType: detected.format.mime,
      byteSize: input.bytes.length,
      warnings
    }
  } catch (err) {
    db.run('ROLLBACK')
    if (err instanceof HierarchyError) {
      return reject('parent_not_found', 404, 'Parent page not found')
    }
    throw err
  }
}
