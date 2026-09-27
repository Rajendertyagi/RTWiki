// officeparser ships a CommonJS build with a thin ESM wrapper that does
// `import _module from './index.js'`. Bun resolves that default import as
// `undefined` for a CJS module, so every named export comes back undefined.
// Importing it as CJS is the only working form, and the failure is silent
// enough to be worth stating here rather than rediscovering later.

import { fileTypeFromBuffer } from 'file-type'
import { parseOffice } from 'officeparser'
import {
  type AcceptedDocumentFormat,
  acceptedDocumentFormatByExt,
  normaliseMimeType,
  signaturelessDocumentFormatFor
} from '../../shared/attachments/document-formats.js'

/**
 * Identifies an uploaded document and extracts its text for the search index.
 *
 * ## The type comes from the bytes, except where it cannot
 *
 * For every format with a container — PDF, DOCX, ODT, XLSX, PPTX, RTF, EPUB —
 * `officeparser` detects the type from the file itself. That result is the
 * authority, and the recorded type is the allowlist's name for it, so a
 * mislabelled upload is stored as what it actually is.
 *
 * `.txt`, `.md` and `.html` have no signature. `officeparser` refuses them, and
 * no library can do better. For those the reported extension is consulted, and
 * because that is a claim rather than evidence they are marked `signatureless` in
 * the allowlist and are **never served back as a document** — their text is
 * extracted and stored as page content instead. The distinction is the whole
 * reason the two paths are separate.
 */

/** Why an upload was refused. */
export type DocumentRejectionReason = 'unsupported_type' | 'empty' | 'extract_failed'

/** Provisional cap on extracted text per document, mirroring the page cap. */
export const DOCUMENT_TEXT_MAX_CHARS = 100_000 as const

/**
 * How many leading bytes are read for format detection.
 *
 * `file-type` documents 4100 as sufficient; the value is not hard-coded here
 * beyond a generous margin, and a prefix rather than the whole file keeps
 * detection cheap on a 50 MB upload.
 */
const DETECTION_PREFIX_BYTES = 4100

export type DocumentInspection =
  | {
      ok: true
      format: AcceptedDocumentFormat
      /** Readable text, for the search index. Empty when none could be read. */
      text: string
    }
  | { ok: false; reason: DocumentRejectionReason }

/**
 * Parses an upload far enough to know what it is and what it says.
 *
 * Text extraction is not optional here: a document whose text cannot be read is
 * a document the user cannot search for, which for a study tool is most of its
 * value. A failure is therefore reported as its own reason rather than being
 * quietly reduced to "stored, but unfindable".
 */
export async function inspectDocumentUpload(
  bytes: Uint8Array,
  reportedType?: string | null
): Promise<DocumentInspection> {
  if (bytes.length === 0) return { ok: false, reason: 'empty' }

  // ## Order matters, and the naive order is a vulnerability
  //
  // Checking the reported type first would mean a PDF renamed to `.txt` is
  // accepted as text, and a DOCX renamed to `.html` has its markup read as the
  // note's text. The declared type must never outrank the bytes.
  //
  // So the container is identified first, and the signature-less path is only
  // reached when the bytes turned out *not* to be a recognisable document. That
  // inverts the obvious order deliberately, and it is the reason a mislabelled
  // upload is stored as what it actually is.
  const parsed = await tryParseContainer(bytes)
  if (parsed) {
    const format = acceptedDocumentFormatByExt(parsed.type)
    if (!format || format.signatureless) return { ok: false, reason: 'unsupported_type' }
    return { ok: true, format, text: parsed.text }
  }

  // Only now may the reported type be consulted, and only for a format the
  // allowlist itself marks as having no signature. That is what stops this path
  // from reaching a *served* format, and what stops a mislabelled container from
  // being downgraded to text.
  //
  // The type is normalised first: a `File` built from text carries a charset, so
  // the browser reports `text/plain;charset=utf-8`, which would otherwise never
  // match the allowlist and every text upload would be refused.
  const signatureless = signaturelessDocumentFormatFor(normaliseMimeType(reportedType))
  if (!signatureless) return { ok: false, reason: 'unsupported_type' }
  if (!looksLikeText(bytes)) return { ok: false, reason: 'unsupported_type' }

  return {
    ok: true,
    format: signatureless,
    text: decodeText(bytes).replace(/\s+/g, ' ').trim().slice(0, DOCUMENT_TEXT_MAX_CHARS)
  }
}

/**
 * Identifies a real container and reads its text, or returns `null` when the
 * bytes are not a container this application accepts.
 *
 * `null` is ambiguous on purpose: it means "the parser did not recognise a
 * document here", which covers both an unrecognised binary and a genuinely
 * signature-less text file. The caller resolves the two.
 */
async function tryParseContainer(
  bytes: Uint8Array
): Promise<{ type: string | null; text: string } | null> {
  // The format is detected here, by `file-type`, and handed to the parser as a
  // hint rather than letting the parser detect it for itself.
  //
  // This is not an optimisation. The parser's own auto-detection **fails inside
  // a compiled executable** — the portable `RTWiki.exe` — because the copy of
  // `file-type` inside it cannot run there, and the parser reports the result as
  // "auto-detection of file type from buffer failed", which is indistinguishable
  // from "this is not a document". Left alone, every document would be silently
  // refused in the shipped build while working perfectly in development.
  //
  // RTWiki already depends on `file-type` and already trusts it for images, and
  // it does work in the compiled build — verified by
  // `bun run test:compiled-images`, which parses a PDF three times in a row in the
  // real executable.
  const detected = await detectContainerFormat(bytes)

  let ast: unknown
  try {
    ast = detected
      ? await parseOffice(bytes, { fileType: detected } as never)
      : await parseOffice(bytes)
  } catch {
    // The parser's message names the format it guessed at. That is not something
    // to show a user and must never be echoed back as an error.
    return null
  }
  return { type: detectOfficeType(ast), text: await readText(ast) }
}

/**
 * The format key `file-type` reports for a document container, or `null`.
 *
 * Only formats RTWiki accepts are returned, so the hint can never introduce a
 * format the allowlist has not already agreed to.
 */
async function detectContainerFormat(bytes: Uint8Array): Promise<string | null> {
  const prefix = bytes.subarray(0, DETECTION_PREFIX_BYTES)
  if (prefix.length === 0) return null
  try {
    const detected = await fileTypeFromBuffer(prefix)
    if (!detected) return null
    return acceptedDocumentFormatByExt(detected.ext)?.signatureless === false ? detected.ext : null
  } catch {
    return null
  }
}

/**
 * The format key `officeparser` identified, or `null` when it reports none.
 *
 * Read from the AST's own `type`, which is a bare format key (`pdf`, `docx`,
 * `odt`) rather than a media type — verified against the real object, because
 * the property names differ from the type definitions. The allowlist is indexed
 * by extension as well as by MIME precisely so this key can be used directly
 * without inventing a second mapping.
 */
function detectOfficeType(ast: unknown): string | null {
  const type = (ast as { type?: unknown })?.type
  return typeof type === 'string' && type.length > 0 ? type.toLowerCase() : null
}

/** Reads the AST's text output, treating any failure as no text. */
async function readText(ast: unknown): Promise<string> {
  try {
    const out = await (ast as { to: (target: 'text') => Promise<{ value?: unknown }> }).to('text')
    const value = out?.value
    if (typeof value !== 'string') return ''
    return value.replace(/\s+/g, ' ').trim().slice(0, DOCUMENT_TEXT_MAX_CHARS)
  } catch {
    // A document can be structurally valid and still yield no text: a scanned
    // PDF with no OCR layer, for instance. That is a normal outcome, not a
    // failure, and the document is still worth storing.
    return ''
  }
}

/** Proportion of control characters that makes a buffer binary rather than text. */
const BINARY_CONTROL_RATIO = 0.3

/**
 * Whether a buffer is plausibly text.
 *
 * Deliberately a heuristic and deliberately cheap: this guards a path that
 * cannot be verified from the bytes, so it errs toward refusing rather than
 * toward decoding. Tab, newline and carriage return are the control characters
 * text legitimately contains.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false
  // Only the head is inspected; a document's beginning is representative and
  // this must not become an O(n) pass over a 50 MB upload.
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192))
  let suspicious = 0
  for (const byte of sample) {
    if (byte === 0) return false
    const isAllowedWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d
    const isPrintable = byte >= 0x20 && byte !== 0x7f
    if (!isAllowedWhitespace && !isPrintable) suspicious++
  }
  return suspicious / sample.length < BINARY_CONTROL_RATIO
}

/**
 * Decodes text bytes, honouring a byte-order mark and falling back to
 * single-byte encoding.
 *
 * UTF-8 is tried first with `fatal`, so bytes that are not valid UTF-8 are not
 * silently replaced with U+FFFD throughout the document — a Windows-1252 file
 * would otherwise index as a page of replacement characters. Latin-1 is the
 * fallback because every byte sequence is valid in it, so text is never lost.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}
