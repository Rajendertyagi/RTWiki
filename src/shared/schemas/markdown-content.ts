import { z } from 'zod'

/**
 * Canonical stored content for the Markdown page type. The Markdown source is
 * deliberately opaque page JSON — never parsed as BlockNote blocks, never
 * indexed verbatim, never rendered into dashboard previews. The database
 * column is unconstrained TEXT, so no migration is required for these pages.
 */

export const MARKDOWN_STARTER_SOURCE = `# Heading

Write **Markdown** with _emphasis_, [links](https://example.com), and:

- task lists
- GFM tables
- ~~strikethrough~~

| Column A | Column B |
| -------- | -------- |
| Cell 1   | Cell 2   |
`

export const MarkdownPageContentSchema = z.object({
  version: z.literal(1),
  markdown: z.string().max(100_000)
})

export type MarkdownPageContent = z.infer<typeof MarkdownPageContentSchema>

export function serializeMarkdownContent(content: MarkdownPageContent): string {
  return JSON.stringify(content)
}

export type ParseMarkdownPageResult =
  | { ok: true; value: MarkdownPageContent }
  | { ok: false; error: string }

/** Total parse: malformed or foreign content yields a contained error. */
export function parseMarkdownPageContent(stored: string): ParseMarkdownPageResult {
  const trimmed = stored.trim()
  if (!trimmed) {
    return { ok: false, error: 'Stored content is empty.' }
  }
  try {
    const parsed = MarkdownPageContentSchema.parse(JSON.parse(trimmed))
    return { ok: true, value: parsed }
  } catch {
    return { ok: false, error: 'Stored content is not a valid Markdown page document.' }
  }
}

/** Starter content used when a Markdown page is created. */
export function createStarterMarkdownContent(): string {
  return serializeMarkdownContent({ version: 1, markdown: MARKDOWN_STARTER_SOURCE })
}
