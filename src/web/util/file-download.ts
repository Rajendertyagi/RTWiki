/**
 * Client-side file helpers for Markdown import/export (Slice 4).
 *
 * Both are pure browser APIs — no dependency, no server round-trip, and no
 * content is ever executed: import only reads text, export only writes text.
 */

import { markdownNoteTitle } from '@rtwiki/shared/import/conversion'

/**
 * Predictable, filesystem-safe filename from an arbitrary page title. Strips the
 * markdown extension if present, removes characters that are illegal in common
 * filesystems, collapses internal whitespace, and bounds the length so exports
 * stay portable across OSes. Never returns an empty string.
 */
export function sanitizeFileName(name: string): string {
  /*
   * The Markdown extension is removed by the shared derivation, built from the import
   * policy's extension list. This used to be a third hand-written copy of the same regex
   * that the import and export handlers each carried.
   *
   * `name.trim()` first, deliberately, and not for tidiness. This call site trimmed
   * *before* stripping while the other two stripped before trimming, and the two orders
   * disagree for a name with whitespace against the extension: `"a.md "` strips to `"a"`
   * when trimmed first and to `"a.md"` when stripped first — which would have exported as
   * `a.md.md`. Passing the trimmed name keeps this function byte-identical to what it was.
   */
  const withoutExt = markdownNoteTitle(name.trim())
  const cleaned = withoutExt
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned.length > 0 ? cleaned : 'untitled').slice(0, 80)
}

/** Triggers a client-side download of text content. Best-effort: failures are
 * swallowed so an export can never disrupt editing. */
export function downloadTextFile(filename: string, text: string, mime = 'text/plain'): void {
  try {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  } catch {
    // Download is best-effort; do not surface as an editor error.
  }
}
