import {
  ACCEPTED_DOCUMENT_FORMATS,
  type AcceptedDocumentFormat,
  normaliseMimeType
} from '@rtwiki/shared/attachments/document-formats'
import { MARKDOWN_IMPORT_MAX_FILE_BYTES, MAX_MARKDOWN_SOURCE_CHARS } from '@rtwiki/shared/constants'
import { markdownSourceExceedsLimit } from '@rtwiki/shared/schemas/markdown-content'

/**
 * The import policy: one place that answers "what can be imported, and how big may it
 * be".
 *
 * ## Why this exists
 *
 * Import used to be three unrelated code paths that each carried their own idea of what
 * was allowed, and they disagreed:
 *
 *  - the **attachment** allowlist (`document-formats.ts`), which governs uploads;
 *  - the **Markdown page picker** in `sidebar.tsx`, which had a hand-written extension
 *    test and its own 1,000,000-byte constant;
 *  - the **stored-content schema**, which capped a Markdown page at 100,000 characters.
 *
 * The second and third were an order of magnitude apart, so a ~150 KB file passed the
 * picker, was posted in full, and was refused by the server with a message naming neither
 * the limit nor the file. The user could start an import the backend was always going to
 * reject — the exact failure this module is written to make impossible.
 *
 * ## Why policy and not validation
 *
 * These are *format decisions*, not input checks, and the two were being confused.
 * Deciding that `.markdown` is Markdown, or that `.csv` is not supported, is a statement
 * about the product. It belongs in one readable list, and every surface should render its
 * file picker, its `accept` attribute and its error messages from that list rather than
 * from a regex someone typed near a component.
 *
 * Server-side enforcement is deliberately **not** here. This module is for the client and
 * for user-facing text; the authoritative checks are the zod schemas, which the server
 * applies on every write.
 */

/**
 * Additional extensions that map onto an existing format.
 *
 * The allowlist stores one extension per MIME type, which is right for choosing a
 * download filename. It is wrong for *accepting* a file, because a format can have more
 * than one conventional extension and a user's file carries the one they typed.
 *
 * - `.markdown` is the same format as `.md`. It was accepted by the Markdown picker and
 *   rejected by the attachment allowlist, so the same file behaved differently depending
 *   on which surface it arrived through. That is the inconsistency this removes.
 * - `.htm` is HTML. It already worked by accident — a browser reports `.htm` files as
 *   `text/html`, so they matched the `html` entry. Relying on that means the format is
 *   undocumented and a picker filtering on extensions does not offer it.
 *
 * Aliases never introduce a format. Each resolves to an existing allowlist entry, so
 * adding one cannot widen what RTWiki accepts, only make the accepted set honest.
 */
const EXTENSION_ALIASES: Readonly<Record<string, string>> = {
  markdown: 'md',
  htm: 'html'
}

/**
 * Formats that are **deliberately not accepted**, with the reason.
 *
 * Recorded so the answer is findable and so nobody re-adds them by accident. A rejection
 * of an unsupported type is a correct outcome, not a gap.
 *
 * - `.csv` / `.tsv` — **not supported.** `officeparser` refuses them: they have no magic
 *   bytes, so its own auto-detection cannot establish a type, and its spreadsheet
 *   reader expects a real spreadsheet container. RTWiki's answer to tabular data is
 *   `.ods` and `.xlsx`, which are in the allowlist and are genuinely detectable. A CSV
 *   would have to arrive through the signature-less text path, at which point it is
 *   plain text with commas, not a document.
 * - `.svg` — **not supported as a document.** Rejected as an image too, deliberately
 *   (`image-formats.ts`), because an SVG is an active document that can carry script.
 *   RTWiki's own HTML pages have a sandboxed renderer; an uploaded SVG has no equivalent.
 */
export const UNSUPPORTED_IMPORT_FORMATS: readonly { ext: string; reason: string }[] = [
  {
    ext: '.csv',
    reason: 'officeparser cannot establish a type for comma-separated values. Use .ods or .xlsx.'
  },
  {
    ext: '.tsv',
    reason: 'officeparser cannot establish a type for tab-separated values. Use .ods or .xlsx.'
  },
  {
    ext: '.svg',
    reason: 'An SVG can carry script, so it is not accepted as a document or an image.'
  }
]

/** The signature-less document formats, resolved from the allowlist rather than retyped. */
const SIGNATURELESS_MIME_TYPES: ReadonlySet<string> = new Set(
  ACCEPTED_DOCUMENT_FORMATS.filter((f) => f.signatureless).map((f) => f.mime)
)

/** Resolves an extension (with or without a leading dot) to an allowlist format. */
export function acceptedFormatForExtension(extension: string): AcceptedDocumentFormat | null {
  const bare = extension.replace(/^\./, '').toLowerCase()
  const resolved = EXTENSION_ALIASES[bare] ?? bare
  return ACCEPTED_DOCUMENT_FORMATS.find((format) => format.ext === resolved) ?? null
}

/**
 * Whether a file may be imported as a **Markdown page**.
 *
 * Name and type are both consulted, exactly as before, but the name test now resolves
 * through the same allowlist the attachment path uses instead of its own regex.
 */
export function isMarkdownFile(file: Pick<File, 'name' | 'type' | 'size'>): boolean {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  if (acceptedFormatForExtension(extension)?.mime === 'text/markdown') return true
  const type = normaliseMimeType(file.type)
  return type === 'text/markdown' || type === 'text/plain'
}

/** Extensions offered for Markdown page import, including aliases. */
export const MARKDOWN_IMPORT_EXTENSIONS: readonly string[] = Object.keys(EXTENSION_ALIASES)
  .filter((alias) => acceptedFormatForExtension(`.${alias}`)?.mime === 'text/markdown')
  .map((alias) => `.${alias}`)
  .concat('.md')

/** The `accept` attribute for the Markdown page file input. */
export const MARKDOWN_IMPORT_ACCEPT_ATTRIBUTE = [...MARKDOWN_IMPORT_EXTENSIONS].join(',')

/**
 * The Markdown page import limit, in characters — the same number the stored-content
 * schema enforces, and therefore the same number the server will enforce.
 */
export const MARKDOWN_IMPORT_MAX_CHARS = MAX_MARKDOWN_SOURCE_CHARS

/** The largest file that will be read into memory before the content is measured. */
export const MARKDOWN_IMPORT_READ_CEILING_BYTES = MARKDOWN_IMPORT_MAX_FILE_BYTES

/**
 * Classifies a chosen file for the Markdown import picker.
 *
 * Returns the reason for refusal rather than a bare boolean, because every refusal needs
 * its own message and a caller that has to re-derive "which check failed" from two
 * numbers is how the two numbers drifted apart in the first place.
 */
export type MarkdownImportRejection =
  | 'not_markdown'
  | 'too_large_to_read'
  | 'too_long'
  | 'read_failed'

export function classifyMarkdownImport(
  file: Pick<File, 'name' | 'type' | 'size'>,
  source?: string
): MarkdownImportRejection | null {
  if (!isMarkdownFile(file)) return 'not_markdown'
  // A transport ceiling, deliberately separate from the content limit: 100,000
  // characters cannot exceed 400 KB of UTF-8, so anything past 1 MiB is certainly over
  // the content limit and is refused before it is decoded.
  if (file.size > MARKDOWN_IMPORT_READ_CEILING_BYTES) return 'too_large_to_read'
  if (source !== undefined && markdownSourceExceedsLimit(source)) return 'too_long'
  return null
}

/** True when this MIME type is accepted but never re-served, so its bytes are not kept. */
export function isSignaturelessDocumentMime(mimeType: string): boolean {
  return SIGNATURELESS_MIME_TYPES.has(mimeType)
}
