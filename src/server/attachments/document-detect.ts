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
  acceptedDocumentFormatFor,
  normaliseMimeType
} from '../../shared/attachments/document-formats.js'
import {
  DOCUMENT_MAX_TABLE_CELLS,
  DOCUMENT_MAX_UNCOMPRESSED_BYTES,
  DOCUMENT_MAX_ZIP_ENTRIES,
  DOCUMENT_PARSE_TIMEOUT_MS
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
 * `.txt`, `.md`, `.html` and `.csv` have no signature. `officeparser` refuses
 * them, and no library can do better. For those the reported extension is
 * consulted, and because that is a claim rather than evidence they are marked
 * `signatureless` in the allowlist. Their text is extracted and stored as page
 * content; since ADR-023 their original bytes are also stored and served back as
 * a forced download (never rendered inline — `/view` still 404s). The distinction
 * is the whole reason the two paths are separate.
 *
 * LaTeX is the one format with no signature that is still a *structured document*:
 * its reported type supplies a hint to `officeparser` (which parses it), rather
 * than sending it down RTWiki's own text reader.
 */

/** Why an upload was refused. */
export type DocumentRejectionReason =
  | 'unsupported_type'
  | 'empty'
  | 'extract_failed'
  /** An old OLE/CFB Office file (.doc/.xls/.ppt), which needs a save-as to a modern format. */
  | 'legacy_office'
  /**
   * An encrypted OOXML file (.docx/.xlsx/.pptx). It is also a CFB container, so it
   * must be told apart from a legacy binary before the save-as message is shown.
   */
  | 'password_protected'

/**
 * Why a recognised container could not be opened.
 *
 * A diagnostic, not a fourth rejection reason: every value produces the same user-facing
 * refusal, because each is answered by "this file could not be opened". The distinction
 * earns its place by making the resource guards **observable** — without it, "a bomb was
 * refused", "a parse ran past its deadline" and "the parser did not recognise my hand-built
 * fixture" are indistinguishable, and a test asserting only that a file is refused would
 * pass whether or not any limit was ever configured. `timeout` is the wall-clock guard's
 * signal; the other two come from the parser's own structured error.
 */
export type DocumentRefusalDetail = 'limit_exceeded' | 'malformed' | 'timeout'

/**
 * How a container parse ended.
 *
 * Three outcomes, not two, and the third is the reason this is a type rather than a
 * `null`: a parser that refuses a ZIP because it would expand past the ceiling is not
 * saying "this is not a document", and reporting it that way tells a user their valid
 * DOCX is an unsupported file type. Keeping the outcomes apart lets the caller answer
 * each for what it is.
 */
export type ContainerParse =
  | { outcome: 'parsed'; type: string | null; text: string; ast: unknown }
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
  /** Wall-clock ceiling for one parse, in ms. Overridable so tests can prove the abort. */
  parseTimeoutMs: number
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
  maxTableCells: DOCUMENT_MAX_TABLE_CELLS,
  parseTimeoutMs: DOCUMENT_PARSE_TIMEOUT_MS
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
  // Detection lives in exactly one place — src/server/ingest/detect-upload.ts.
  // This wrapper preserves the attachment route's existing contract: flattened
  // text for the search index, and `unsupported_type` for images so the route
  // falls through to image detection. The dynamic import keeps the two modules
  // from forming a static cycle (the new module reuses the helpers below).
  const { detectDocumentUpload } = await import('../ingest/detect-upload.js')
  const detected = await detectDocumentUpload(bytes, reportedType, limits)
  if (!detected.ok) {
    return {
      ok: false,
      reason: detected.reason,
      ...(detected.detail ? { detail: detected.detail } : {})
    }
  }
  if (detected.kind === 'document') {
    return { ok: true, format: detected.format, text: detected.searchText }
  }
  return {
    ok: true,
    format: detected.format,
    text: detected.rawText.replace(/\s+/g, ' ').trim().slice(0, DOCUMENT_TEXT_MAX_CHARS)
  }
}

/**
 * The options every `parseOffice` call in this module shares.
 *
 * Factored out so the CFB classifier below asks the parser the exact same question
 * the main parse does — same in-process PDF mode, same ceilings, same deadline —
 * and the two cannot drift apart. `hint` is the only thing that varies per call.
 */
function parseOfficeOptions(
  limits: Readonly<DocumentResourceLimits>,
  signal: AbortSignal,
  hint?: string | null
): Record<string, unknown> {
  return {
    ...(hint ? { fileType: hint } : {}),
    // Embedded images are extracted so the ingest path can store them as
    // attachments and rewrite Markdown references to RTWiki URLs (ADR-024 §3).
    // Without this, `ast.attachments` is empty and images are silently lost.
    extractAttachments: true,
    // officeparser's default `separateProcess: true` never completes its child-process
    // handshake under Bun, so a PDF parse hangs forever. In-process pdf.js works; the
    // `abortSignal` cancels work that yields to the event loop, though it cannot
    // interrupt a synchronous CPU-bound parse (see the characterization test).
    pdfParserConfig: { separateProcess: false },
    decompressionLimits: {
      maxUncompressedBytes: limits.maxUncompressedBytes,
      maxZipEntries: limits.maxZipEntries,
      maxTableCells: limits.maxTableCells
    },
    abortSignal: signal
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
export async function tryParseContainer(
  bytes: Uint8Array,
  limits: Readonly<DocumentResourceLimits>,
  reportedType?: string | null
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
  // A format with no magic number (LaTeX) cannot be identified from the bytes. For
  // those, fall back to a hint from the reported type — but only for a format the
  // allowlist accepts as a served document, and only when the bytes are plausibly
  // text, so a binary file renamed to .tex is not decoded as LaTeX.
  const hint = detected ?? reportedTypeHint(bytes, reportedType)

  // A wall-clock backstop for the parse. officeparser's own PDF time limit applies only
  // when pdf.js runs in a separate process, which is disabled below, so this timer is
  // what stops a hostile document from hanging the server. `abortSignal` is a top-level
  // parseOffice option; the timer is cleared in `finally` so a fast parse never leaves a
  // pending abort behind.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), limits.parseTimeoutMs)

  let ast: unknown
  try {
    ast = await parseOffice(bytes, parseOfficeOptions(limits, controller.signal, hint) as never)
  } catch (err) {
    // The parser's message names the format it guessed at. That is not something
    // to show a user and must never be echoed back as an error.
    //
    // The magic-number check is what stops this from firing on every image: a PNG also
    // makes the parser throw, and reporting that as "a document I could not open" would
    // refuse every image in the application.
    if (!looksLikeAContainer(bytes)) return { outcome: 'not_a_document' }
    return { outcome: 'refused', detail: refusalDetail(err) }
  } finally {
    clearTimeout(timeout)
  }
  // The AST used to be discarded here after its text was read. The ingest path
  // needs it to call `ast.to('md')`, so it is retained on the parsed outcome.
  return { outcome: 'parsed', type: detectOfficeType(ast), text: await readText(ast), ast }
}

/**
 * Why the parser refused a container it had recognised.
 *
 * Read from the structured `officeIssue` the parser attaches to its errors, and read
 * defensively: the property is not part of any type RTWiki can import, and a value of
 * an unexpected shape must answer "malformed" rather than throw inside an error path.
 *
 * An abort is checked first: officeparser rejects with an error whose `name` is
 * 'AbortError' (a DOMException or a plain Error), deliberately unwrapped so callers can
 * recognise cancellation. It is our own deadline firing, not a parse failure, so it is
 * reported as `timeout` rather than falling through to `malformed`. Exported so the
 * mapping can be asserted directly — the timer itself cannot be relied on to fire
 * during synchronous pdf.js work (see the characterization test in document-detect.test.ts).
 */
export function refusalDetail(err: unknown): DocumentRefusalDetail {
  if (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError')
    return 'timeout'
  if (typeof err !== 'object' || err === null) return 'malformed'
  const issue = (err as { officeIssue?: unknown }).officeIssue
  if (typeof issue !== 'object' || issue === null) return 'malformed'
  const code = (issue as { code?: unknown }).code
  return typeof code === 'string' && LIMIT_EXCEEDED_CODES.has(code) ? 'limit_exceeded' : 'malformed'
}

/**
 * The raw format key `file-type` reports from the bytes, or `null`.
 *
 * Shared by the container hint and the legacy-Office check so the prefix is read
 * and the detector called the same way in both places.
 */
async function detectBytesFormat(bytes: Uint8Array): Promise<string | null> {
  const prefix = bytes.subarray(0, DETECTION_PREFIX_BYTES)
  if (prefix.length === 0) return null
  try {
    const detected = await fileTypeFromBuffer(prefix)
    return detected?.ext ?? null
  } catch {
    return null
  }
}

/**
 * The format key `file-type` reports for a document container, or `null`.
 *
 * Only formats RTWiki accepts are returned, so the hint can never introduce a
 * format the allowlist has not already agreed to.
 */
async function detectContainerFormat(bytes: Uint8Array): Promise<string | null> {
  const ext = await detectBytesFormat(bytes)
  return ext !== null && acceptedDocumentFormatByExt(ext)?.signatureless === false ? ext : null
}

/**
 * The codes officeparser uses when an encrypted document needs a password it was
 * not given. Both mean "this file is password-protected", whatever the format.
 */
const PASSWORD_CODES = new Set(['PASSWORD_REQUIRED', 'PASSWORD_INCORRECT'])

/**
 * Classifies an OLE/CFB container, or returns `null` when the bytes are not CFB.
 *
 * A CFB container is ambiguous: it is either an old binary Office file
 * (.doc/.xls/.ppt) or a *modern* Office file (.docx/.xlsx/.pptx) locked with a
 * password. Both are reported as `cfb` by `file-type`, so the bytes alone cannot
 * tell them apart. officeparser can: it recognises the encryption streams and
 * refuses with `PASSWORD_REQUIRED` before doing any decryption work, while a
 * legacy binary is refused as an unsupported `cfb` type. Asking it is the
 * authoritative answer and avoids duplicating its container parsing here.
 */
export async function classifyCfbContainer(
  bytes: Uint8Array,
  limits: Readonly<DocumentResourceLimits>
): Promise<'password_protected' | 'legacy_office' | null> {
  if ((await detectBytesFormat(bytes)) !== 'cfb') return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), limits.parseTimeoutMs)
  try {
    await parseOffice(bytes, parseOfficeOptions(limits, controller.signal) as never)
    // A CFB container that actually parsed is not expected; treat it as legacy
    // rather than accepting a format RTWiki has no allowlist entry for.
    return 'legacy_office'
  } catch (err) {
    const code = (err as { officeIssue?: { code?: unknown } })?.officeIssue?.code
    return typeof code === 'string' && PASSWORD_CODES.has(code)
      ? 'password_protected'
      : 'legacy_office'
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * The officeparser hint for a format `file-type` could not identify from the bytes.
 *
 * Two families need this. LaTeX has no magic number at all. The macro-enabled and
 * template OOXML files are ZIPs whose content-type override `file-type` does not
 * read, so it reports a bare `zip` — which is not on the allowlist and yields no
 * hint. In both cases the reported media type names a format the allowlist already
 * accepts, and officeparser resolves the variant to its base parser itself.
 *
 * The hint comes from a claim rather than from the bytes, so it is gated: a
 * text-based format requires plausible text, and a container requires a container
 * signature. A binary upload renamed to `.tex` is therefore not decoded as LaTeX.
 */
function reportedTypeHint(
  bytes: Uint8Array,
  reportedType: string | null | undefined
): string | null {
  const format = acceptedDocumentFormatFor(normaliseMimeType(reportedType))
  // Signature-less formats go down RTWiki's own text reader, never through the
  // parser, so they must not produce a hint here.
  if (!format || format.signatureless) return null
  if (format.ext === 'tex') return looksLikeText(bytes) ? 'tex' : null
  return looksLikeAContainer(bytes) ? format.ext : null
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
