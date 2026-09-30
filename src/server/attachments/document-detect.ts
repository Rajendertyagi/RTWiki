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
import {
  DOCUMENT_MAX_TABLE_CELLS,
  DOCUMENT_MAX_UNCOMPRESSED_BYTES,
  DOCUMENT_MAX_ZIP_ENTRIES
} from '../../shared/constants/index.js'

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

/**
 * Why a recognised container could not be opened.
 *
 * A diagnostic, not a fourth rejection reason: both values produce the same user-facing
 * refusal, because both are answered by "this file could not be opened". The distinction
 * earns its place by making the resource guard **observable** — without it, "a bomb was
 * refused" and "the parser did not recognise my hand-built fixture" are indistinguishable,
 * and a test asserting only that a bomb is refused would pass whether or not any limit was
 * ever configured.
 */
export type DocumentRefusalDetail = 'limit_exceeded' | 'malformed'

/**
 * How a container parse ended.
 *
 * Three outcomes, not two, and the third is the reason this is a type rather than a
 * `null`: a parser that refuses a ZIP because it would expand past the ceiling is not
 * saying "this is not a document", and reporting it that way tells a user their valid
 * DOCX is an unsupported file type. Keeping the outcomes apart lets the caller answer
 * each for what it is.
 */
type ContainerParse =
  | { outcome: 'parsed'; type: string | null; text: string }
  /** The parser did not recognise a document here. See the note on the old `null`. */
  | { outcome: 'not_a_document' }
  /** A real container was recognised and then refused. */
  | { outcome: 'refused'; detail: DocumentRefusalDetail }

/** Provisional cap on extracted text per document, mirroring the page cap. */
export const DOCUMENT_TEXT_MAX_CHARS = 100_000 as const

/**
 * Resource ceilings applied to a document parse.
 *
 * Named as a type because the shape is the library's, but the *values* are RTWiki's.
 */
export interface DocumentResourceLimits {
  maxUncompressedBytes: number
  maxZipEntries: number
  maxTableCells: number
}

/**
 * The ceilings every production parse uses.
 *
 * Frozen so nothing downstream can weaken them by assignment, and exposed as a default
 * parameter rather than read at each call site, so there is exactly one place a limit is
 * written and exactly one place a caller could raise it deliberately.
 */
export const DOCUMENT_RESOURCE_LIMITS: Readonly<DocumentResourceLimits> = Object.freeze({
  maxUncompressedBytes: DOCUMENT_MAX_UNCOMPRESSED_BYTES,
  maxZipEntries: DOCUMENT_MAX_ZIP_ENTRIES,
  maxTableCells: DOCUMENT_MAX_TABLE_CELLS
})

/**
 * The parser's own codes for a refusal caused by a ceiling being reached.
 *
 * Matched on the structured code rather than on message text: the parser brands every
 * error it raises with `officeIssue.code`, and that is the documented way to branch on it.
 * A truncated archive raises a *different* code, so the two are not conflated — a
 * malformed file is not reported as too large, and a genuine bomb is not reported as
 * merely broken.
 */
const LIMIT_EXCEEDED_CODES = new Set(['ZIP_SIZE_LIMIT_EXCEEDED', 'ZIP_ENTRY_COUNT_LIMIT_EXCEEDED'])

/**
 * Whether the bytes *are* a document container, judged from their first four bytes.
 *
 * This exists because a thrown parse error cannot distinguish two very different things:
 * "this is a DOCX I recognised and could not open" and "this is a PNG, which is not a
 * document at all". Both make the parser throw. Treating the throw as a refusal would refuse
 * every image upload in the application.
 *
 * So the evidence is taken from the bytes instead, on the same principle the rest of this
 * module follows — the declared type and the parser's opinion of the file are both claims,
 * and the leading magic number is the only thing here that is not. ZIP covers DOCX, XLSX,
 * PPTX, ODT, ODS, ODP, ODG and EPUB, all of which are `PK\x03\x04`; PDF is `%PDF`.
 *
 * RTF is deliberately absent: it is a text format with no signature, so RTWiki treats it
 * the way it treats `.txt` — recognised from the reported type, never from its bytes — and
 * there is no magic number to check.
 */
function looksLikeAContainer(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
  return isZip || isPdf
}

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
  | { ok: false; reason: DocumentRejectionReason; detail?: DocumentRefusalDetail }

/**
 * Parses an upload far enough to know what it is and what it says.
 *
 * Text extraction is not optional here: a document whose text cannot be read is
 * a document the user cannot search for, which for a study tool is most of its
 * value. A failure is therefore reported as its own reason rather than being
 * quietly reduced to "stored, but unfindable".
 *
 * `limits` exists so a test can prove the resource ceilings are actually wired to the
 * parser rather than inherited: the real ceiling is 512 MB of uncompressed content, and a
 * fixture that reaches it would have to *be* 512 MB. The production path passes nothing
 * and therefore cannot accidentally be given a weaker guard.
 */
export async function inspectDocumentUpload(
  bytes: Uint8Array,
  reportedType?: string | null,
  limits: Readonly<DocumentResourceLimits> = DOCUMENT_RESOURCE_LIMITS
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
  const parsed = await tryParseContainer(bytes, limits)

  if (parsed.outcome === 'parsed') {
    const format = acceptedDocumentFormatByExt(parsed.type)
    if (!format || format.signatureless) return { ok: false, reason: 'unsupported_type' }
    return { ok: true, format, text: parsed.text }
  }

  // A container that was recognised and then refused is not "not a document". Falling
  // through to the signature-less branch would consult the *reported* type for bytes that
  // are demonstrably a ZIP or a PDF — which is the same error, in a milder form, as the
  // ordering inversion above: letting a claim outrank evidence. It is refused here
  // instead, and as `extract_failed` rather than `unsupported_type`, because the user's
  // file type is supported; it is this file that could not be opened.
  if (parsed.outcome === 'refused')
    return { ok: false, reason: 'extract_failed', detail: parsed.detail }

  // ## Why the detail is not surfaced to the user
  //
  // Reaching a decompression ceiling and finding a truncated archive are both "this file
  // could not be opened", and both are refused identically. A separate user-facing reason
  // would say *why* a limit tripped, which tells a user nothing they can act on about a
  // file they can only fix by making it smaller. The distinction is not discarded: it
  // travels on the rejection as `detail`, which is what makes the guard testable — a
  // refusal asserted without it would not distinguish a tripped ceiling from a parser that
  // simply did not recognise the bytes.

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
 * Identifies a real container and reads its text, or reports why it could not.
 *
 * The three outcomes are distinguished because the caller must treat them
 * differently: an unrecognised buffer may still be a signature-less text file
 * (which is accepted on its reported type), while a recognised container the
 * parser *refused* is a failed upload and must not be downgraded to either
 * "unsupported type" or a text read.
 *
 * ## Resource ceilings
 *
 * `decompressionLimits` is passed on every parse, and it is the only thing standing
 * between a small upload and an unbounded allocation. `PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES`
 * bounds what arrives; it does not bound what a compressed archive asks the parser to
 * expand it into. Both ZIP-backed formats and PDF are affected, and a repeated byte
 * run is the cheap way to cross the gap.
 */
async function tryParseContainer(
  bytes: Uint8Array,
  limits: Readonly<DocumentResourceLimits>
): Promise<ContainerParse> {
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
    ast = await parseOffice(bytes, {
      ...(detected ? { fileType: detected } : {}),
      decompressionLimits: {
        maxUncompressedBytes: limits.maxUncompressedBytes,
        maxZipEntries: limits.maxZipEntries,
        maxTableCells: limits.maxTableCells
      }
    } as never)
  } catch (err) {
    // The parser's message names the format it guessed at. That is not something
    // to show a user and must never be echoed back as an error.
    //
    // The magic-number check is what stops this from firing on every image: a PNG also
    // makes the parser throw, and reporting that as "a document I could not open" would
    // refuse every image in the application.
    if (!looksLikeAContainer(bytes)) return { outcome: 'not_a_document' }
    return { outcome: 'refused', detail: refusalDetail(err) }
  }
  return { outcome: 'parsed', type: detectOfficeType(ast), text: await readText(ast) }
}

/**
 * Why the parser refused a container it had recognised.
 *
 * Read from the structured `officeIssue` the parser attaches to its errors, and read
 * defensively: the property is not part of any type RTWiki can import, and a value of
 * an unexpected shape must answer "malformed" rather than throw inside an error path.
 */
function refusalDetail(err: unknown): DocumentRefusalDetail {
  if (typeof err !== 'object' || err === null) return 'malformed'
  const issue = (err as { officeIssue?: unknown }).officeIssue
  if (typeof issue !== 'object' || issue === null) return 'malformed'
  const code = (issue as { code?: unknown }).code
  return typeof code === 'string' && LIMIT_EXCEEDED_CODES.has(code) ? 'limit_exceeded' : 'malformed'
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
