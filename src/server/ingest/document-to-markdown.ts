import { acceptedImageFormatFor } from '../../shared/attachments/image-formats.js'
import type { DetectedUpload } from './detect-upload.js'
import type { IngestWarning } from './ingest-types.js'

/**
 * The structured conversion boundary: a detected upload in, Markdown out.
 *
 * For containers this is a thin adapter over officeparser's own `ast.to('md')`
 * call. RTWiki deliberately does not write an AST walker — that would be a
 * second parser to keep in step with the dependency, and it would drift silently
 * on a version bump. Signature-less files have no AST at all, so their raw text
 * is the honest ceiling and is passed through unchanged.
 *
 * Embedded images are extracted by officeparser at parse time (`ast.attachments`)
 * and stored as ordinary image attachments by the ingest core. The Markdown
 * generator's `onNode` callback rewrites each image node to the RTWiki URL, so
 * no string post-processing of the generated Markdown is needed.
 */

/** Image-related issue codes officeparser reports during parse or generation. */
const IMAGE_ISSUE_CODES: ReadonlySet<string> = new Set([
  'IMAGE_EXTRACTION_FAILED',
  'IMAGE_PROCESSING_FAILED',
  'IMAGE_NOT_INLINED',
  'IMAGES_NOT_BUNDLED'
])

/** The code officeparser uses when a PDF yielded essentially no text. */
const NO_TEXT_ISSUE_CODE = 'PDF_NO_TEXT_EXTRACTED'

/**
 * A parse-time warning: a part of the document (a chapter, a relationships
 * part, an embedded object) was not read, so its content is absent from the AST.
 * The app used to ignore `ast.warnings` entirely, which made this silent loss.
 */
const PART_NOT_READ_ISSUE_CODE = 'CONTENT_PART_NOT_READ'

export type DocumentToMarkdownResult =
  | { ok: true; markdown: string; warnings: readonly IngestWarning[] }
  | { ok: false; reason: 'conversion_failed'; message: string }

const IMAGES_NOT_IMPORTED_WARNING: IngestWarning = {
  code: 'images_not_imported',
  message:
    'Some images in this document could not be imported. Only the text and the images that were brought across are present.'
}

const EMPTY_EXTRACTION_WARNING: IngestWarning = {
  code: 'empty_extraction',
  message: 'Little or no text could be read from this document. It may be a scan needing OCR.'
}

const PARTS_NOT_READ_WARNING: IngestWarning = {
  code: 'parts_not_read',
  message:
    'Some parts of this document could not be read, so their content is missing. Open the original file to see everything.'
}

/** An image extracted from a document, ready to be stored as an attachment. */
export interface ExtractedImage {
  readonly name: string
  readonly mimeType: string
  readonly bytes: Uint8Array
  readonly altText?: string
}

/** The images officeparser extracted, plus a count of those RTWiki could not use. */
export interface ImageExtraction {
  readonly images: readonly ExtractedImage[]
  /** Images present in the source but skipped (unsupported type, no bytes, bad data). */
  readonly skipped: number
}

/**
 * Reads officeparser's own `attachments` array — no handwritten AST walk.
 *
 * Only image attachments with an accepted image MIME type and decodable bytes
 * are returned. Anything else (SVG, a chart without bytes, malformed base64) is
 * counted as skipped so the caller can warn rather than silently lose it.
 */
export function extractImages(ast: unknown): ImageExtraction {
  const attachments = (ast as { attachments?: unknown }).attachments
  if (!Array.isArray(attachments)) return { images: [], skipped: 0 }

  const images: ExtractedImage[] = []
  let skipped = 0
  for (const item of attachments) {
    if (typeof item !== 'object' || item === null) {
      skipped++
      continue
    }
    const candidate = item as {
      type?: unknown
      mimeType?: unknown
      data?: unknown
      name?: unknown
      altText?: unknown
    }
    // Charts are rendered as tables by the Markdown generator, not as pictures;
    // only image attachments need a stored byte stream and a URL rewrite.
    if (candidate.type !== 'image') continue
    if (
      typeof candidate.mimeType !== 'string' ||
      typeof candidate.data !== 'string' ||
      typeof candidate.name !== 'string'
    ) {
      skipped++
      continue
    }
    // Reuse the existing image allowlist: SVG and unknown types stay refused,
    // exactly as for a directly uploaded image.
    if (!acceptedImageFormatFor(candidate.mimeType)) {
      skipped++
      continue
    }
    let bytes: Uint8Array
    try {
      bytes = Buffer.from(candidate.data, 'base64')
    } catch {
      skipped++
      continue
    }
    if (bytes.length === 0) {
      skipped++
      continue
    }
    images.push({
      name: candidate.name,
      mimeType: candidate.mimeType,
      bytes,
      ...(typeof candidate.altText === 'string' ? { altText: candidate.altText } : {})
    })
  }
  return { images, skipped }
}

/** Maps an officeparser attachment name to the RTWiki URL of its stored copy. */
export type ImageUrlResolver = (attachmentName: string) => string | null

/**
 * Escapes document-supplied alt text for a Markdown image label.
 *
 * Alt text is untrusted document metadata. Interpolated verbatim into
 * `![alt](url)`, a value such as `x](https://evil.example) ![y` would close the
 * label and inject a link into the stored page. Backslash is escaped first so
 * the later escapes are not undone; newlines are collapsed so one image cannot
 * break across lines and inject block structure.
 */
function escapeMarkdownAltText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\r\n]+/g, ' ')
}

export interface ConversionOptions {
  /** When supplied, image nodes are rendered as links to the stored attachments. */
  readonly imageUrlResolver?: ImageUrlResolver
  /** Images the source contained but RTWiki could not store — surfaced as a warning. */
  readonly skippedImages?: number | (() => number)
  /** Called when an image node's name cannot be resolved to a stored attachment. */
  readonly onUnresolvedImage?: (attachmentName: string) => void
}

function issueCode(issue: unknown): string | null {
  if (typeof issue !== 'object' || issue === null) return null
  const code = (issue as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

/** Whether officeparser reported an image it could not bring across. */
function libraryReportedImageLoss(messages: readonly unknown[]): boolean {
  return messages.some((issue) => IMAGE_ISSUE_CODES.has(issueCode(issue) ?? ''))
}

function failed(): DocumentToMarkdownResult {
  return {
    ok: false,
    reason: 'conversion_failed',
    message: 'This document could not be converted into editable content.'
  }
}

/**
 * Converts a detected upload into Markdown.
 *
 * When `imageUrlResolver` is supplied, officeparser's `onNode` callback renders
 * each image node as a Markdown image pointing at the stored attachment. Without
 * a resolver (e.g. a direct unit test of conversion) images are omitted, and the
 * caller is responsible for warning about the omission.
 */
export async function documentToMarkdown(
  detected: DetectedUpload,
  options: ConversionOptions = {}
): Promise<DocumentToMarkdownResult> {
  if (detected.kind === 'text') {
    if (detected.rawText.trim().length === 0) return failed()
    return { ok: true, markdown: detected.rawText, warnings: [] }
  }

  // An image has no text to convert. It is still stored as an attachment by the
  // ingest core, but it cannot become an editable page on its own.
  if (detected.kind === 'image') return failed()

  const config: Record<string, unknown> = {
    // GFM/CommonMark renderers show `{#slug}` heading anchors as literal text.
    generateIds: false
  }
  if (options.imageUrlResolver) {
    config.includeImages = 'image-only'
    config.onNode = (node: {
      type?: unknown
      metadata?: { attachmentName?: unknown; altText?: unknown }
    }) => {
      if (node.type !== 'image') return undefined
      const name = node.metadata?.attachmentName
      if (typeof name !== 'string') return undefined
      const url = options.imageUrlResolver?.(name)
      if (!url) {
        options.onUnresolvedImage?.(name)
        return undefined
      }
      const alt = typeof node.metadata?.altText === 'string' ? node.metadata.altText : ''
      return `![${escapeMarkdownAltText(alt)}](${url})`
    }
  } else {
    config.includeImages = 'none'
  }

  let result: { value?: unknown; messages?: unknown[] }
  try {
    result = await (
      detected.ast as {
        to: (
          target: 'md',
          config?: Record<string, unknown>
        ) => Promise<{ value?: unknown; messages?: unknown[] }>
      }
    ).to('md', config)
  } catch {
    return failed()
  }

  const value = result?.value
  if (typeof value !== 'string' || value.trim().length === 0) return failed()

  const messages = result.messages ?? []
  const warnings: IngestWarning[] = []
  const skipped =
    typeof options.skippedImages === 'function'
      ? options.skippedImages()
      : (options.skippedImages ?? 0)
  if (libraryReportedImageLoss(messages) || skipped > 0) {
    warnings.push(IMAGES_NOT_IMPORTED_WARNING)
  }
  if (messages.some((issue) => issueCode(issue) === NO_TEXT_ISSUE_CODE))
    warnings.push(EMPTY_EXTRACTION_WARNING)

  // `CONTENT_PART_NOT_READ` is a PARSE-time warning on `ast.warnings`, not a
  // generation message. Read the library-owned array directly — no AST walk —
  // so a part the parser could not read is never silently dropped.
  const parseWarnings = (detected.ast as { warnings?: unknown }).warnings
  if (
    Array.isArray(parseWarnings) &&
    parseWarnings.some((issue) => issueCode(issue) === PART_NOT_READ_ISSUE_CODE)
  ) {
    warnings.push(PARTS_NOT_READ_WARNING)
  }

  return { ok: true, markdown: value, warnings }
}
