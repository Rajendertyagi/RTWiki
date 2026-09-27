/**
 * How a document's name is put into a `Content-Disposition` header.
 *
 * ## Why this is not a sanitiser
 *
 * The name reaches a response header, not the filesystem, so the job is not to
 * strip dangerous path characters but to produce a string that cannot *end* the
 * header. Two things achieve that, and both are needed:
 *
 * 1. The value is encoded so it contains no quote, semicolon, CR or LF at all.
 * 2. It is emitted through RFC 5987 (`filename*=UTF-8''…`), which is the
 *    encoding designed for non-ASCII names and is what every current browser
 *    reads.
 *
 * Stripping characters instead — which is what a filename sanitiser does — is the
 * wrong tool here. Verified while building this: `sanitize-filename` removes the
 * control characters but leaves U+202E (RIGHT-TO-LEFT OVERRIDE) in place, so a
 * name can still be displayed reversed. Encoding sidesteps the whole class,
 * because a percent-encoded string cannot contain a character that ends a header.
 */

/**
 * Characters that must never appear literally in a header value.
 *
 * Anything in this set is percent-encoded, which is why the encoding step below
 * is the actual defence and this list is belt and braces.
 */
const FORBIDDEN_IN_HEADER = /["\r\n;\\]/

/** How much of a name to keep before it stops being a filename. */
const MAX_DISPLAY_NAME_CHARS = 120

/**
 * Builds the `Content-Disposition` value for offering a document for download.
 *
 * Two forms are emitted together, which is what the specification requires: the
 * plain `filename=` for old clients, and `filename*=` for the percent-encoded
 * UTF-8 form that current browsers prefer.
 *
 * @param kind Either `attachment` (save it) or `inline` (let the browser try to
 *   render it). RTWiki only ever uses `attachment` — see ADR-015 §3.
 * @param originalName The name the uploader supplied, used for display only.
 * @param fallbackExtension Used when the uploader's name has no usable
 *   extension, so a download is never offered with no name at all.
 */
export function contentDisposition(
  kind: 'attachment' | 'inline',
  originalName: string | null | undefined,
  fallbackExtension: string
): string {
  const safeAscii = asciiFallbackName(originalName, fallbackExtension)
  const encoded = encodeRFC5987(originalName, fallbackExtension)
  return `${kind}; filename="${safeAscii}"; filename*=UTF-8''${encoded}`
}

/**
 * A plain-ASCII name for clients that do not read `filename*`.
 *
 * Built by removing anything outside a conservative set rather than by
 * "sanitising" known-bad patterns, so an unexpected character cannot survive by
 * not being in a blocklist.
 */
function asciiFallbackName(
  originalName: string | null | undefined,
  fallbackExtension: string
): string {
  const base = baseName(originalName)
  const withoutMarks = base.replace(/[^A-Za-z0-9._ -]/g, '_')
  const collapsed = withoutMarks.replace(/_{2,}/g, '_').replace(/^[ ._-]+/, '')
  const bounded = collapsed.slice(0, MAX_DISPLAY_NAME_CHARS)
  const withExtension = /\.[A-Za-z0-9]{1,8}$/.test(bounded)
    ? bounded
    : `${bounded || 'document'}.${fallbackExtension}`
  // A name that is only dots would resolve to the current or parent directory.
  return /^\.+$/.test(withExtension) ? `document.${fallbackExtension}` : withExtension
}

/**
 * The percent-encoded UTF-8 form.
 *
 * Built from the base name with anything that could terminate a header encoded
 * away, so the result is safe by construction rather than by inspection.
 */
function encodeRFC5987(originalName: string | null | undefined, fallbackExtension: string): string {
  const base = baseName(originalName)
  const source = base.length > 0 ? base : `document.${fallbackExtension}`
  let out = ''
  for (const byte of new TextEncoder().encode(source.slice(0, 200))) {
    const char = String.fromCharCode(byte)
    if (FORBIDDEN_IN_HEADER.test(char) || byte < 0x21 || byte > 0x7e) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    } else {
      out += char
    }
  }
  return out
}

/**
 * The name with no directory part.
 *
 * The uploader's name is data, never a path, but a name containing a separator
 * would put a path in a header a user reads, so it is reduced to its last
 * component before anything else happens to it.
 */
function baseName(originalName: string | null | undefined): string {
  if (typeof originalName !== 'string') return ''
  const lastSeparator = Math.max(originalName.lastIndexOf('/'), originalName.lastIndexOf('\\'))
  const trimmed = lastSeparator >= 0 ? originalName.slice(lastSeparator + 1) : originalName
  // Control characters are removed by code point rather than by a regex literal
  // containing them. The intent is identical and the intent is the point here:
  // a literal CR or LF in a pattern is the sort of thing that survives a later
  // edit and stops meaning what it says.
  return stripControlCharacters(trimmed).trim()
}

/** C0 controls and DEL: none of them belong in a name a person reads. */
function stripControlCharacters(value: string): string {
  let out = ''
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) continue
    out += character
  }
  return out
}
