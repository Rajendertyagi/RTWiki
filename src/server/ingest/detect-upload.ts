import {
  type AcceptedDocumentFormat,
  acceptedDocumentFormatByExt,
  normaliseMimeType,
  signaturelessDocumentFormatFor
} from '../../shared/attachments/document-formats.js'
import {
  type AcceptedImageFormat,
  acceptedImageFormatFor
} from '../../shared/attachments/image-formats.js'
import { PROVISIONAL_MAX_IMAGE_PIXELS } from '../../shared/constants/index.js'
import {
  classifyCfbContainer,
  DOCUMENT_RESOURCE_LIMITS,
  DOCUMENT_TEXT_MAX_CHARS,
  type DocumentRefusalDetail,
  type DocumentRejectionReason,
  type DocumentResourceLimits,
  decodeText,
  looksLikeText,
  tryParseContainer
} from '../attachments/document-detect.js'
import {
  detect as detectImageFormat,
  type ImageRejectionReason,
  looksLikeSvg,
  pixelCount,
  readDimensions
} from '../attachments/image-detect.js'

/**
 * The single detection pipeline for every import path.
 *
 * Both HTTP consumers of ingest and the existing attachment route reach the
 * same decisions through this module: document detection, signature-less text
 * detection and image detection are orchestrated here exactly once. The
 * low-level parsers stay in their own modules as reusable helpers; what used to
 * be duplicated was the *ordering* and the result mapping, and that is what
 * lives here now.
 *
 * Two properties matter and are easy to lose in a refactor:
 *
 * - **Bytes outrank the reported type.** A container is identified from its own
 *   magic bytes first; the reported type is consulted only for formats that
 *   have no signature at all.
 * - **Structure is retained.** A container's parsed AST is returned rather than
 *   discarded, and signature-less text is returned unflattened. The attachment
 *   route flattens text for its search index; the ingest path needs the original
 *   line breaks for Markdown conversion.
 */

/** A recognised upload, with the structure the ingest path needs. */
export type DetectedUpload =
  | {
      kind: 'text'
      format: AcceptedDocumentFormat
      /** Raw, unflattened text. Line breaks are preserved and nothing is truncated. */
      rawText: string
      /**
       * True when the decoded text exceeded `DOCUMENT_TEXT_MAX_CHARS`. The ingest
       * path refuses such a file rather than silently losing the tail; the
       * attachment route keeps its own truncating behaviour for the search index.
       */
      truncated: boolean
    }
  | {
      kind: 'document'
      format: AcceptedDocumentFormat
      /** The officeparser AST, retained so the converter can call `ast.to('md')`. */
      ast: unknown
      /** Flattened text for the attachment route's search index. */
      searchText: string
    }
  | {
      kind: 'image'
      format: AcceptedImageFormat
      width: number | null
      height: number | null
    }

/** Why detection refused an upload. */
export type DetectRejectionReason =
  | 'empty'
  | 'unsupported_type'
  | 'svg_not_supported'
  | 'too_many_pixels'
  | 'extract_failed'
  | 'legacy_office'
  | 'password_protected'

export type DetectResult =
  | ({ ok: true } & DetectedUpload)
  | { ok: false; reason: DetectRejectionReason; detail?: DocumentRefusalDetail }

/** Document-only detection, used by `inspectDocumentUpload`. */
export type DocumentDetectResult =
  | {
      ok: true
      kind: 'text'
      format: AcceptedDocumentFormat
      rawText: string
      truncated: boolean
    }
  | {
      ok: true
      kind: 'document'
      format: AcceptedDocumentFormat
      ast: unknown
      searchText: string
    }
  | { ok: false; reason: DocumentRejectionReason; detail?: DocumentRefusalDetail }

/** Image-only detection, used by `inspectImageUpload`. */
export type ImageDetectResult =
  | { ok: true; format: AcceptedImageFormat; width: number | null; height: number | null }
  | { ok: false; reason: ImageRejectionReason }

export interface DetectOptions {
  /** Document parse ceilings. Defaults to the production limits. */
  readonly limits?: Readonly<DocumentResourceLimits>
  /** Pixel ceiling for images. Defaults to the shared constant. */
  readonly maxImagePixels?: number
}

/**
 * Identifies a document or signature-less text upload.
 *
 * This is the document half of the old `inspectDocumentUpload`, with two
 * deliberate differences: the AST is retained and the signature-less text is
 * not flattened. The caller decides what to do with each.
 */
export async function detectDocumentUpload(
  bytes: Uint8Array,
  reportedType?: string | null,
  limits: Readonly<DocumentResourceLimits> = DOCUMENT_RESOURCE_LIMITS
): Promise<DocumentDetectResult> {
  if (bytes.length === 0) return { ok: false, reason: 'empty' }

  // OLE/CFB is ambiguous: a legacy binary needs a save-as, a password-protected
  // modern file needs its password removed. Both are refused before any other
  // detection, exactly as in the original implementation.
  const cfbKind = await classifyCfbContainer(bytes, limits)
  if (cfbKind) return { ok: false, reason: cfbKind }

  // Bytes first. The reported type is not consulted until the bytes have been
  // shown not to be a recognisable container — that is what stops a PDF renamed
  // to `.txt` being read as text.
  const parsed = await tryParseContainer(bytes, limits, reportedType)

  if (parsed.outcome === 'parsed') {
    const format = acceptedDocumentFormatByExt(parsed.type)
    if (!format || format.signatureless) return { ok: false, reason: 'unsupported_type' }
    return {
      ok: true,
      kind: 'document',
      format,
      ast: parsed.ast,
      searchText: parsed.text
    }
  }

  // A container that was recognised and then refused is not "not a document".
  // Falling through to the signature-less branch would let the reported type
  // outrank the bytes in a milder form, so it is refused here instead.
  if (parsed.outcome === 'refused')
    return { ok: false, reason: 'extract_failed', detail: parsed.detail }

  // Only now may the reported type be consulted, and only for a format the
  // allowlist itself marks as having no signature. Normalisation matters: a
  // `File` built from text reports `text/plain;charset=utf-8`.
  const signatureless = signaturelessDocumentFormatFor(normaliseMimeType(reportedType))
  if (!signatureless) return { ok: false, reason: 'unsupported_type' }
  if (!looksLikeText(bytes)) return { ok: false, reason: 'unsupported_type' }

  // The bug this module fixes: the old code flattened with `.replace(/\s+/g, ' ')`
  // here. The ingest path needs the original line breaks to produce Markdown, so
  // the raw text is returned untouched. It is also returned *untruncated*: the
  // old `.slice(0, DOCUMENT_TEXT_MAX_CHARS)` silently dropped the tail of a large
  // file, which is content loss (AGENTS.md §4). The flag lets the ingest path
  // refuse the file outright while the attachment route keeps truncating for its
  // search index in `inspectDocumentUpload`.
  const rawText = decodeText(bytes)
  return {
    ok: true,
    kind: 'text',
    format: signatureless,
    rawText,
    truncated: rawText.length > DOCUMENT_TEXT_MAX_CHARS
  }
}

/**
 * Identifies an image upload. The pixel ceiling is deliberately *not* applied
 * here: "what is this" and "is this too big to open" stay separable questions,
 * and the existing attachment route performs its own pixel check.
 */
export async function detectImageUpload(bytes: Uint8Array): Promise<ImageDetectResult> {
  // Checked before detection: an SVG is XML text that `file-type` cannot name
  // reliably, but the user still deserves the specific reason.
  if (looksLikeSvg(bytes)) return { ok: false, reason: 'svg_not_supported' }

  const detected = await detectImageFormat(bytes)
  if (!detected) return { ok: false, reason: 'unsupported_type' }
  if (detected.mime === 'image/svg+xml' || detected.mime === 'image/svg')
    return { ok: false, reason: 'svg_not_supported' }

  const format = acceptedImageFormatFor(detected.mime)
  if (!format) return { ok: false, reason: 'unsupported_type' }

  const { width, height } = readDimensions(bytes, format)
  return { ok: true, format, width, height }
}

/**
 * The full detection pipeline used by the ingest core.
 *
 * Document detection runs first so bytes outrank the reported type. A document
 * that was recognised but could not be opened is refused outright; only a file
 * that is demonstrably *not* a document falls through to image detection.
 */
export async function detectUpload(
  bytes: Uint8Array,
  reportedType?: string | null,
  options: DetectOptions = {}
): Promise<DetectResult> {
  const document = await detectDocumentUpload(bytes, reportedType, options.limits)
  if (document.ok) {
    // The success variants are structurally identical to the corresponding
    // `DetectedUpload` variants, so no remapping is needed.
    return document
  }

  // A recognised container that failed to open, a legacy binary, an encrypted
  // modern file and an empty upload are all final answers. Trying to read any
  // of them as an image would replace the real diagnosis with "unsupported".
  if (
    document.reason === 'empty' ||
    document.reason === 'extract_failed' ||
    document.reason === 'legacy_office' ||
    document.reason === 'password_protected'
  ) {
    return {
      ok: false,
      reason: document.reason,
      ...(document.detail ? { detail: document.detail } : {})
    }
  }

  const image = await detectImageUpload(bytes)
  if (!image.ok) return { ok: false, reason: image.reason }

  const pixels = pixelCount(image.width, image.height)
  if (pixels !== null && pixels > (options.maxImagePixels ?? PROVISIONAL_MAX_IMAGE_PIXELS))
    return { ok: false, reason: 'too_many_pixels' }

  return {
    ok: true,
    kind: 'image',
    format: image.format,
    width: image.width,
    height: image.height
  }
}
