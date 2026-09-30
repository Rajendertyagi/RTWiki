import { z } from 'zod'
import { MAX_MARKDOWN_SOURCE_CHARS } from '../constants/index.js'

/**
 * Canonical stored content for the Markdown page type. The Markdown source is
 * deliberately opaque page JSON — never parsed as BlockNote blocks, never
 * indexed verbatim, never rendered into dashboard previews. The database
 * column is unconstrained TEXT, so no migration is required for these pages.
 */

export const MARKDOWN_STARTER_SOURCE = `# Topic Title

> A one-line summary of what this note covers.

## Key Points

- First important point
- Second important point
- Third important point

## Definitions

| Term      | Meaning        |
| --------- | -------------- |
| Concept A | Short meaning |
| Concept B | Short meaning |

## Code

\`\`\`ts
const example = 'replace with real code';
\`\`\`

## Checklist

- [ ] Read the source material
- [ ] Summarize in your own words
- [ ] Test your understanding

See the [project home](https://example.com) for related notes.
`

export const MarkdownPageContentSchema = z.object({
  version: z.literal(1),
  markdown: z.string().max(MAX_MARKDOWN_SOURCE_CHARS)
})

export type MarkdownPageContent = z.infer<typeof MarkdownPageContentSchema>

export function serializeMarkdownContent(content: MarkdownPageContent): string {
  return JSON.stringify(content)
}

export type ParseMarkdownPageResult =
  | { ok: true; value: MarkdownPageContent }
  | { ok: false; error: string }

/**
 * Total parse: malformed or foreign content yields a contained error.
 *
 * The two failures are reported **separately**, and this is the point of the function
 * as it now stands. It used to collapse every failure into "Stored content is not a
 * valid Markdown page document", which is wrong in both senses for the common case: the
 * content is well-formed Markdown, it is merely too long, and nothing was "stored" when
 * this runs on an incoming create. A user who imported a 150 KB file was told their
 * file was not a valid document, with no limit named and no way to tell what to do.
 */
export function parseMarkdownPageContent(stored: string): ParseMarkdownPageResult {
  const trimmed = stored.trim()
  if (!trimmed) {
    return { ok: false, error: 'Stored content is empty.' }
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'Stored content is not valid JSON.' }
  }
  const parsed = MarkdownPageContentSchema.safeParse(decoded)
  if (parsed.success) {
    return { ok: true, value: parsed.data }
  }
  // Name the real reason. The over-length case is the one a user can act on, and it is
  // the one the import path can now catch before it ever reaches the server.
  for (const issue of parsed.error.issues) {
    if (issue.code === 'too_big' && issue.path[0] === 'markdown') {
      return {
        ok: false,
        error: `This note's Markdown is longer than the ${MAX_MARKDOWN_SOURCE_CHARS.toLocaleString('en-US')} character limit.`
      }
    }
    if (issue.path[0] === 'version') {
      return { ok: false, error: 'This note was saved by a different version of RTWiki.' }
    }
  }
  return { ok: false, error: 'Stored content is not a valid Markdown page document.' }
}

/**
 * Whether a Markdown **source string** is within the limit, for use before it is wrapped
 * and sent. The same number the schema will apply, so a file refused here is a file the
 * server was always going to refuse.
 */
export function markdownSourceExceedsLimit(source: string): boolean {
  return source.length > MAX_MARKDOWN_SOURCE_CHARS
}

/** Starter content used when a Markdown page is created. */
export function createStarterMarkdownContent(): string {
  return serializeMarkdownContent({ version: 1, markdown: MARKDOWN_STARTER_SOURCE })
}
