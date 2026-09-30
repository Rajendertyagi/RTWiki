import { describe, expect, it } from 'bun:test'
import {
  ACCEPTED_DOCUMENT_FORMATS,
  acceptedDocumentFormatFor
} from '../src/shared/attachments/document-formats'
import { MAX_MARKDOWN_SOURCE_CHARS } from '../src/shared/constants/index.js'
import {
  acceptedFormatForExtension,
  classifyMarkdownImport,
  isMarkdownFile,
  isSignaturelessDocumentMime,
  MARKDOWN_IMPORT_ACCEPT_ATTRIBUTE,
  MARKDOWN_IMPORT_EXTENSIONS,
  UNSUPPORTED_IMPORT_FORMATS
} from '../src/shared/import/policy'
import {
  createStarterMarkdownContent,
  markdownSourceExceedsLimit,
  parseMarkdownPageContent,
  serializeMarkdownContent
} from '../src/shared/schemas/markdown-content'

/**
 * The import policy, and the limit it shares with the stored-content schema.
 *
 * These exist because two import surfaces disagreed: a picker that allowed 1,000,000
 * *bytes* and a schema that allowed 100,000 *characters*. A file in the gap was accepted
 * by the first and always refused by the second, and the user was told their file was
 * "not a valid Markdown page document" — with no limit named and nothing created.
 */
describe('Markdown import limits', () => {
  it('uses one number for the character limit everywhere', () => {
    // The schema must read the shared constant, not a literal. If someone edits one and
    // not the other, the picker and the server drift apart again.
    const atLimit = 'x'.repeat(MAX_MARKDOWN_SOURCE_CHARS)
    const parsed = parseMarkdownPageContent(
      serializeMarkdownContent({ version: 1, markdown: atLimit })
    )
    expect(parsed.ok).toBe(true)
  })

  it('refuses one character over the limit, and names the limit', () => {
    const over = 'x'.repeat(MAX_MARKDOWN_SOURCE_CHARS + 1)
    expect(markdownSourceExceedsLimit(over)).toBe(true)
    const parsed = parseMarkdownPageContent(
      serializeMarkdownContent({ version: 1, markdown: over })
    )
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    // The old message was "Stored content is not a valid Markdown page document", which
    // is wrong twice: it is valid Markdown, and nothing has been stored.
    expect(parsed.error).toContain('100,000')
    expect(parsed.error.toLowerCase()).toContain('markdown')
  })

  it('distinguishes a too-long note from malformed JSON', () => {
    const malformed = parseMarkdownPageContent('{not json')
    expect(malformed.ok).toBe(false)
    if (malformed.ok) return
    expect(malformed.error).toBe('Stored content is not valid JSON.')
  })

  it('distinguishes a foreign document version from other failures', () => {
    const foreign = parseMarkdownPageContent(JSON.stringify({ version: 99, markdown: 'hi' }))
    expect(foreign.ok).toBe(false)
    if (foreign.ok) return
    expect(foreign.error).toContain('different version')
  })

  it('accepts starter content, so a new note is never over the limit', () => {
    expect(markdownSourceExceedsLimit(createStarterMarkdownContent())).toBe(false)
  })
})

describe('the import policy classifies a chosen file', () => {
  const md = { name: 'notes.md', type: 'text/markdown', size: 10 }

  it('accepts .md and .markdown and refuses a .txt', () => {
    expect(isMarkdownFile(md)).toBe(true)
    expect(isMarkdownFile({ name: 'notes.markdown', type: '', size: 10 })).toBe(true)
    expect(isMarkdownFile({ name: 'photo.png', type: 'image/png', size: 10 })).toBe(false)
  })

  it('refuses an over-long source with its own reason, not the byte reason', () => {
    // The distinction the user actually needs: "too big to read" and "too long to store"
    // are different problems with different remedies.
    const tooLong = classifyMarkdownImport(md, 'x'.repeat(MAX_MARKDOWN_SOURCE_CHARS + 1))
    expect(tooLong).toBe('too_long')
    const tooBigToRead = classifyMarkdownImport({ ...md, size: 50 * 1024 * 1024 })
    expect(tooBigToRead).toBe('too_large_to_read')
    const fine = classifyMarkdownImport(md, '# hello')
    expect(fine).toBeNull()
  })

  it('offers the extensions it accepts, from the allowlist rather than a regex', () => {
    expect(MARKDOWN_IMPORT_EXTENSIONS).toContain('.md')
    expect(MARKDOWN_IMPORT_EXTENSIONS).toContain('.markdown')
    expect(MARKDOWN_IMPORT_ACCEPT_ATTRIBUTE).toContain('.md')
    // And nothing that is not Markdown.
    for (const ext of MARKDOWN_IMPORT_EXTENSIONS) {
      expect(acceptedFormatForExtension(ext)?.mime).toBe('text/markdown')
    }
  })
})

describe('format policy is internally consistent', () => {
  it('resolves an extension alias to an existing allowlist entry, and invents nothing', () => {
    for (const alias of ['.markdown', '.htm']) {
      const resolved = acceptedFormatForExtension(alias)
      expect(resolved).not.toBeNull()
      // It must be a real entry, not a new format smuggled in beside one.
      expect(ACCEPTED_DOCUMENT_FORMATS).toContain(resolved as never)
    }
    expect(acceptedFormatForExtension('.csv')).toBeNull()
    expect(acceptedFormatForExtension('.tsv')).toBeNull()
    expect(acceptedFormatForExtension('.svg')).toBeNull()
  })

  it('records the deliberately unsupported formats with a reason', () => {
    // A rejection of an unsupported type is a correct outcome, not a gap. The reason is
    // recorded so nobody re-adds .csv because a dependency once mentioned it.
    for (const ext of ['.csv', '.tsv', '.svg']) {
      const entry = UNSUPPORTED_IMPORT_FORMATS.find((f) => f.ext === ext)
      expect(entry, `${ext} must have a recorded reason`).toBeDefined()
      expect((entry?.reason ?? '').length).toBeGreaterThan(10)
    }
  })

  it('derives the signature-less set from the allowlist, so the two cannot disagree', () => {
    // The decision was: a signature-less upload keeps its extracted text and NOT its
    // bytes. That is only safe if "signature-less" is read from one place.
    const expected = ACCEPTED_DOCUMENT_FORMATS.filter((f) => f.signatureless).map((f) => f.mime)
    for (const mime of expected) {
      expect(isSignaturelessDocumentMime(mime)).toBe(true)
    }
    for (const format of ACCEPTED_DOCUMENT_FORMATS.filter((f) => !f.signatureless)) {
      expect(isSignaturelessDocumentMime(format.mime)).toBe(false)
      // A servable format must be in the served set, or its bytes would be kept and
      // then refused.
      expect(acceptedDocumentFormatFor(format.mime)).not.toBeNull()
    }
    expect(expected).toEqual(['text/plain', 'text/markdown', 'text/html'])
  })
})
