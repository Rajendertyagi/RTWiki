import { MAX_MARKDOWN_SOURCE_CHARS } from '@rtwiki/shared/constants'
import type { PageType } from '@rtwiki/shared/contracts/pages'
import {
  acceptedFormatForExtension,
  MARKDOWN_IMPORT_EXTENSIONS
} from '@rtwiki/shared/import/policy'
import {
  markdownSourceExceedsLimit,
  serializeMarkdownContent
} from '@rtwiki/shared/schemas/markdown-content'

/**
 * The conversion boundary: imported content in, editable RTWiki content out.
 *
 * ## What problem this solves
 *
 * Until now, "read a file and turn it into a note" had no home. The logic lived inside a
 * React component (`App.tsx`), split across a title regex and an envelope call, and the
 * extension it stripped was hard-coded there as well — so the file name and the format
 * policy each had their own idea of what a Markdown file is called. Adding a second source
 * format would have meant a second copy of that code in a second component.
 *
 * This module is that home, and nothing else. It sits between parsing and page creation:
 *
 * ```text
 *   import source
 *        ↓
 *   import policy / detection / parsing      (policy.ts, document-detect.ts)
 *        ↓
 *   conversion adapter boundary              (this module)
 *        ↓
 *   normalised editable content
 *        ↓
 *   page / note creation                     (page-service.ts)
 * ```
 *
 * ## What it deliberately is not
 *
 * It is **not** a document-to-document converter, and nothing here knows what a DOCX is.
 * The input is text plus the format the import policy already resolved; the output is the
 * stored content string `pages.content` expects. That is the whole contract, and it is what
 * lets a future DOCX or HTML converter be a new entry in [CONVERSION_ADAPTERS] rather than a
 * new branch threaded through a component.
 *
 * It also produces **no** editor objects. The output is a serialised string and a page type,
 * so the boundary has no dependency on BlockNote and cannot drift when the editor's block
 * set changes.
 *
 * ## Why only Markdown exists
 *
 * Because that is the only editable conversion the product currently performs. A `.txt` or
 * `.docx` attached to a note stays an **attachment**: its text is extracted for search and
 * the file itself is stored ([ADR-015](../../docs/adr/ADR-015-document-attachments.md)). That
 * is the shipped behaviour and it is unchanged here — adding a DOCX converter would change
 * what an attachment *is*, which is a product decision, not an architectural one.
 */

/** One entry in the import pipeline: a source that has already been identified. */
export interface ImportSourceDocument {
  /** The readable text of the source. May be empty; each adapter decides what that means. */
  readonly text: string
  /**
   * The file's own name, as the user chose it.
   *
   * Kept verbatim so a converter can derive a title from it exactly as the product did
   * before. It is a *display* string only: nothing here treats it as a path, which is what
   * keeps a crafted file name from reaching anything that resolves one.
   */
  readonly fileName: string
  /**
   * The allowlist format key the import policy resolved, without a leading dot — `md`,
   * `html`, `pdf`. Aliases are already resolved, so `.markdown` arrives as `md`.
   */
  readonly format: string
}

/** Why a source could not be converted into editable content. */
export type ConversionFailureReason =
  /** No adapter is registered for this format. The honest answer for DOCX today. */
  | 'unsupported_conversion'
  /** The adapter refused the source: nothing to convert, or the result is not storable. */
  | 'source_refused'

/**
 * Editable content, normalised and ready to be stored on a page.
 *
 * `storedContent` is exactly what `pages.content` holds — for every page type that is a
 * serialised, versioned envelope, and the adapter has already produced it. Callers do not
 * re-serialise, so there is one place where a stored representation is built.
 */
export interface ConvertedContent {
  readonly pageType: PageType
  readonly storedContent: string
  /**
   * A title derived from the source, or `''` when none could be.
   *
   * Empty rather than a placeholder: the fallback string is user-facing text, and this
   * module is shared code that must not reach into the web UI dictionary. Every existing
   * caller already does `title || UI_TEXT.untitledPage`, so that is left exactly where it
   * was.
   */
  readonly title: string
  /**
   * Things the user should know that did not stop the conversion.
   *
   * Empty for a clean conversion. A source that converted but lost something belongs here,
   * not in a refusal — the alternative is throwing away a usable note over a warning.
   */
  readonly warnings: readonly string[]
}

/** The outcome of a conversion. Failure is a value, never a thrown error. */
export type ConversionResult =
  | { readonly ok: true; readonly value: ConvertedContent }
  | { readonly ok: false; readonly reason: ConversionFailureReason; readonly message: string }

/**
 * One format's conversion.
 *
 * Adapters are plain data, not a class hierarchy: a format is a key and a function. That is
 * what keeps the set of supported conversions visible in one list instead of spread across a
 * `switch`.
 */
export interface ConversionAdapter {
  /** The allowlist format keys this adapter converts from. */
  readonly formats: readonly string[]
  convert(source: ImportSourceDocument): ConversionResult
}

/**
 * The title a Markdown note takes from the name of the file it came from.
 *
 * Exported on its own, not just used internally, because **three** call sites need this
 * exact answer and it was written out three times: the import handler, the export handler
 * and the filename sanitiser. An export is not an import, so routing it through the
 * converter would have been a semantic fiction to avoid a copy-paste; a named function is
 * the honest shared thing.
 *
 * Built from `MARKDOWN_IMPORT_EXTENSIONS` rather than written out, so the title can never
 * disagree with the file picker about which names count as Markdown. The set is identical
 * to the regex it replaces, including its case-insensitivity, so no page changes name.
 *
 * Returns `''` when nothing usable remains; callers apply their own fallback, because the
 * fallback is user-facing text and this module is shared.
 */
export function markdownNoteTitle(fileName: string): string {
  /*
   * Each alternative carries its own leading dot, escaped here, so the pattern is a single
   * group with no extra `\.` in front of it. Adding one demands *two* dots and strips
   * nothing from `notes.md` — which is exactly what it did before this comment existed.
   */
  const alternatives = MARKDOWN_IMPORT_EXTENSIONS.map((ext) => ext.replace('.', '\\.')).join('|')
  return fileName.replace(new RegExp(`(${alternatives})$`, 'i'), '').trim()
}

/**
 * The Markdown converter.
 *
 * The only adapter that exists, and the only editable conversion RTWiki performs today.
 * Everything it does was previously inline in the page component.
 */
const markdownAdapter: ConversionAdapter = {
  formats: ['md'],

  convert(source: ImportSourceDocument): ConversionResult {
    // An empty file is refused here rather than becoming a blank note. It is the one case
    // where the conversion genuinely has nothing to produce, and silently creating an empty
    // page would be a worse answer than saying so.
    if (source.text.trim().length === 0) {
      return {
        ok: false,
        reason: 'source_refused',
        message: 'That file has no content to import.'
      }
    }

    /*
     * The limit is re-checked here even though the picker already applied it, because this
     * is the boundary every future source passes through and the stored schema is what
     * ultimately refuses. `MAX_MARKDOWN_SOURCE_CHARS` is the same number the server
     * enforces, so a source that converted is a source the server will accept — which is
     * the property the import policy was written to guarantee.
     */
    if (markdownSourceExceedsLimit(source.text)) {
      return {
        ok: false,
        reason: 'source_refused',
        message: `This note's Markdown is longer than the ${MAX_MARKDOWN_SOURCE_CHARS.toLocaleString('en-US')} character limit.`
      }
    }

    return {
      ok: true,
      value: {
        pageType: 'markdown',
        storedContent: serializeMarkdownContent({ version: 1, markdown: source.text }),
        title: markdownNoteTitle(source.fileName),
        warnings: []
      }
    }
  }
}

/**
 * The registered adapters.
 *
 * A DOCX or HTML converter is added here and nowhere else. That single list is the whole
 * extension point, which is the reason this boundary is worth having.
 */
export const CONVERSION_ADAPTERS: readonly ConversionAdapter[] = [markdownAdapter]

/**
 * Converts an identified import source into editable RTWiki content.
 *
 * @param format - the allowlist key, with or without a leading dot. Aliases are resolved
 *   here rather than by the caller, so every entry point gets the same answer.
 * @returns the editable content, or an explicit failure. Never throws.
 */
export function convertImportedDocument(
  format: string,
  source: Omit<ImportSourceDocument, 'format'>
): ConversionResult {
  // `acceptedFormatForExtension` is the policy's own resolver, so this cannot accept a
  // format the allowlist rejects, and a `.csv` cannot reach an adapter by accident.
  const resolved = acceptedFormatForExtension(format)?.ext ?? null
  if (resolved === null) {
    return {
      ok: false,
      reason: 'unsupported_conversion',
      message: 'That file type cannot be converted into an editable note.'
    }
  }

  const document: ImportSourceDocument = { ...source, format: resolved }
  const adapter = CONVERSION_ADAPTERS.find((candidate) => candidate.formats.includes(resolved))
  if (adapter === undefined) {
    return {
      ok: false,
      reason: 'unsupported_conversion',
      message: 'That file type cannot be converted into an editable note.'
    }
  }
  return adapter.convert(document)
}
