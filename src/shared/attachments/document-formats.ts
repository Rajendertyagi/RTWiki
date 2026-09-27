/**
 * The document formats RTWiki accepts — the single source of truth for that list.
 *
 * ## The same shape as the image allowlist, for the same reason
 *
 * This module is *policy*: which documents are allowed, and what we call them. It
 * does not inspect bytes. Deciding what a file actually is happens server-side
 * in `src/server/attachments/document-detect.ts`, which reads the file's own
 * bytes and then looks the answer up here.
 *
 * The split exists because this file is imported by the browser (the file
 * picker's `accept` attribute), so nothing here may pull in a Node-only module.
 * The parser that does the heavy lifting (`officeparser`) is server-side.
 *
 * ## Why documents are not detected by their magic number alone
 *
 * `.txt`, `.md` and `.html` have no signature at all — there is nothing in the
 * bytes that says "this is Markdown". `officeparser` refuses them outright
 * ("Auto-detection of file type from buffer failed"), which is correct: a
 * library cannot know either. RTWiki therefore handles them by *format of
 * origin* rather than by detection:
 *
 * - A `.txt`/`.md`/`.html` upload is identified by the extension the *user's
 *   browser* reports, read **once**, and its text is extracted and stored as the
 *   page's own content. The original file is never served back as a document.
 * - Everything with a real container (PDF, DOCX, ODT, XLSX, PPTX, RTF, EPUB) is
 *   identified from its bytes, and the bytes decide.
 *
 * This is the same approach the reference implementation takes: text is converted
 * on import and never stored as a servable file.
 */

/** A document format RTWiki accepts. */
export interface AcceptedDocumentFormat {
  /**
   * The only type recorded and served for this format.
   *
   * Ours, never the uploader's. For the signature-less formats this comes from
   * the reported extension, which is why they are marked below.
   */
  readonly mime: string
  /** The extension used when offering the file for download. */
  readonly ext: string
  /**
   * True when the bytes cannot identify this format, so the reported extension
   * is the only signal available.
   *
   * Such a format is never *served* as a document; its text is extracted on
   * import instead. The flag exists so the detection module and the tests can
   * state that plainly rather than leaving it to be inferred.
   */
  readonly signatureless: boolean
}

/**
 * Formats accepted for document attachment.
 *
 * PDF is the common case and is listed first only for readability; the order
 * carries no meaning because each entry is looked up by type.
 *
 * The office and OpenDocument families are included because `officeparser`
 * handles them, and because a study note's attachments are overwhelmingly
 * lecture slides and readings rather than spreadsheets.
 *
 * The signature-less trio is deliberately included with `signatureless: true`.
 * They are accepted, their text is extracted, and they are never re-served as a
 * document — see the module comment.
 */
export const ACCEPTED_DOCUMENT_FORMATS: readonly AcceptedDocumentFormat[] = [
  { mime: 'application/pdf', ext: 'pdf', signatureless: false },
  // Office Open XML
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
    signatureless: false
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: 'pptx',
    signatureless: false
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
    signatureless: false
  },
  // OpenDocument
  { mime: 'application/vnd.oasis.opendocument.text', ext: 'odt', signatureless: false },
  {
    mime: 'application/vnd.oasis.opendocument.presentation',
    ext: 'odp',
    signatureless: false
  },
  { mime: 'application/vnd.oasis.opendocument.spreadsheet', ext: 'ods', signatureless: false },
  // Rich Text, and e-books
  { mime: 'application/rtf', ext: 'rtf', signatureless: false },
  { mime: 'application/epub+zip', ext: 'epub', signatureless: false },
  // No signature: identified by the reported extension, converted on import,
  // and never served back as a document.
  { mime: 'text/plain', ext: 'txt', signatureless: true },
  { mime: 'text/markdown', ext: 'md', signatureless: true },
  { mime: 'text/html', ext: 'html', signatureless: true }
]

/** Fast lookup from a type to the format RTWiki stores. */
const ACCEPTED_BY_MIME: ReadonlyMap<string, AcceptedDocumentFormat> = new Map(
  ACCEPTED_DOCUMENT_FORMATS.map((format) => [format.mime, format])
)

/**
 * Fast lookup from a bare format key to the format RTWiki stores.
 *
 * The document parser reports a format key (`pdf`, `docx`, `odt`) rather than a
 * media type, so this is the index its results are resolved through. Without it
 * every detected format would need a hand-written key-to-MIME mapping, which is
 * exactly the second list that lets two things disagree.
 */
const ACCEPTED_BY_EXT: ReadonlyMap<string, AcceptedDocumentFormat> = new Map(
  ACCEPTED_DOCUMENT_FORMATS.map((format) => [format.ext, format])
)

/** The subset whose bytes can identify them, and which is therefore served. */
export const SERVED_DOCUMENT_MIME_TYPES: readonly string[] = ACCEPTED_DOCUMENT_FORMATS.filter(
  (f) => !f.signatureless
).map((f) => f.mime)

/** Types the client may present in a file input's `accept`. */
export const ACCEPTED_DOCUMENT_MIME_TYPES: readonly string[] = ACCEPTED_DOCUMENT_FORMATS.map(
  (f) => f.mime
)

/**
 * Every extension we accept, for the picker's `accept` attribute.
 *
 * Extensions are listed as well as types because a file input filters far more
 * usefully on `.pdf,.docx` than on the equivalent MIME list, and because a
 * signature-less format is *only* identifiable by its extension.
 */
export const ACCEPTED_DOCUMENT_EXTENSIONS: readonly string[] = ACCEPTED_DOCUMENT_FORMATS.map(
  (f) => `.${f.ext}`
)

/** The `accept` attribute for a document file input, from the same list. */
export const DOCUMENT_FILE_ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_DOCUMENT_MIME_TYPES,
  ...ACCEPTED_DOCUMENT_EXTENSIONS
].join(',')

/** A type RTWiki will accept, or `null` if it is not on the list. */
export function acceptedDocumentFormatFor(
  mime: string | null | undefined
): AcceptedDocumentFormat | null {
  const normalised = normaliseMimeType(mime)
  return normalised ? (ACCEPTED_BY_MIME.get(normalised) ?? null) : null
}

/**
 * Strips parameters from a media type, lowercased.
 *
 * Necessary rather than cosmetic: a `File` built from a `Blob` reports its type
 * with a charset appended — `text/plain;charset=utf-8` — so an exact lookup
 * never matches and every text upload is refused. Trimming at the semicolon is
 * what the media-type specification calls for, and it is why the same trap is
 * avoided for every format rather than only the text ones.
 */
export function normaliseMimeType(mime: string | null | undefined): string | null {
  if (typeof mime !== 'string') return null
  const trimmed = mime.split(';')[0]?.trim().toLowerCase() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

/** A format key the parser reported, resolved to what RTWiki stores. */
export function acceptedDocumentFormatByExt(
  ext: string | null | undefined
): AcceptedDocumentFormat | null {
  if (!ext) return null
  return ACCEPTED_BY_EXT.get(ext.toLowerCase()) ?? null
}

/**
 * The format a signature-less type maps to, or `null`.
 *
 * Separate from {@link acceptedDocumentFormatFor} because it is only ever
 * consulted for a type the parser could not identify, and a caller must not be
 * able to reach a *served* format through it.
 */
export function signaturelessDocumentFormatFor(
  mime: string | null | undefined
): AcceptedDocumentFormat | null {
  const format = acceptedDocumentFormatFor(mime)
  return format?.signatureless ? format : null
}
