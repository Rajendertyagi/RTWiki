import { describe, expect, it } from 'bun:test'
import { markdownNoteTitle } from '../src/shared/import/policy.js'
import { sanitizeFileName } from '../src/web/util/file-download.js'

/**
 * Title derivation is the one piece of the old conversion boundary that is
 * still a client concern: the export path needs a filename, and the server's
 * ingest path needs a page title. Both call the same DOM-free policy function,
 * so this test pins it to the regex it replaced rather than to an adapter that
 * no longer exists (ADR-024 removed the parallel conversion path).
 */
describe('title derivation is unchanged from the regex it replaced', () => {
  /*
   * The expression that used to sit in `App.tsx` — twice — and produced every imported
   * Markdown page's name. Pinned here so extracting it cannot quietly rename a user's
   * pages, which is the specific regression a "harmless" refactor of this code would cause.
   */
  const legacy = (fileName: string): string => fileName.replace(/\.(md|markdown)$/i, '').trim()

  const names = [
    'notes.md',
    'notes.markdown',
    'NOTES.MD',
    'Notes.MarkDown',
    'a.md.md',
    'a.markdown.md',
    'notes.txt',
    'notes',
    '.md',
    '.markdown',
    '  spaced.md  ',
    'no-ext',
    'report.MARKDOWN',
    'x.markdown.markdown',
    'trailing.md.bak',
    'dot.in.name.md',
    'weird..md',
    'semicolon;name.md',
    '....md'
  ]

  it.each(names)('derives the same title as the legacy regex for %j', (fileName) => {
    expect(markdownNoteTitle(fileName)).toBe(legacy(fileName))
  })

  it('leaves a name with no Markdown extension alone, as it always did', () => {
    // `notes.txt` is accepted by the picker (it is text), and the old regex left the
    // extension in place. Preserved deliberately: changing it would rename existing notes.
    expect(markdownNoteTitle('notes.txt')).toBe('notes.txt')
  })

  it.each([
    'notes.md',
    'NOTES.MD',
    ' a.md ',
    'a.md ',
    ' .md',
    '',
    '  ',
    'weird..md',
    'a b.md',
    'x.MARKDOWN',
    'report.md.bak',
    '  spaced  .md  ',
    '..md..'
  ])('keeps the export filename sanitizer byte-identical for %j', (name) => {
    /*
     * `sanitizeFileName` was the *third* copy of this regex, and the only one that trimmed
     * before stripping rather than after. Unifying it on the other two orders silently
     * changed exported filenames: `"a.md "` became `a.md.md`. This pins the shipped result
     * to the function it replaced, whitespace cases included.
     */
    const legacySanitize = (): string => {
      const withoutExt = name.trim().replace(/\.(md|markdown)$/i, '')
      const cleaned = withoutExt
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
      return (cleaned.length > 0 ? cleaned : 'untitled').slice(0, 80)
    }
    expect(sanitizeFileName(name)).toBe(legacySanitize())
  })
})
