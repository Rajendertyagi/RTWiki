/**
 * Content-based image type detection for uploads.
 *
 * ## Why the client's `Content-Type` is not trusted
 *
 * The declared type is attacker-controlled: a request can claim `image/png` while
 * carrying anything at all. Trusting it is how an image endpoint becomes a
 * cross-site-scripting vector - the server stores the file, hands back a URL, and
 * the browser renders it with whatever type the server repeats back.
 *
 * So the type here is decided by the file's own leading bytes, and it is the only
 * type ever recorded or served. The client's claim is not consulted.
 *
 * ## Why SVG is deliberately not accepted
 *
 * SVG is XML that can carry `<script>`, event handlers and external references.
 * Serving one inline is document execution, which the security model forbids for
 * uploaded content ("no execution of uploaded documents; serve attachments as
 * static content only"). Excluding it is simpler and safer than trying to
 * sanitise arbitrary SVG, and it costs a format nobody pastes into a study note.
 * A note can still link to an SVG hosted elsewhere.
 */

/** An accepted image format, decided by signature rather than by claim. */
export interface ImageFormat {
  /** The only type recorded and served for this format. */
  readonly mime: string
  /** The extension used in the stored filename, chosen by us for the same reason. */
  readonly ext: string
  /** Matches the file's leading bytes. */
  readonly matches: (bytes: Uint8Array) => boolean
}

/** Byte-wise comparison of ASCII text at an offset. */
function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}

/**
 * Formats accepted for upload, in detection order.
 *
 * PNG and JPEG come first because they are what a screenshot or a phone photo
 * produces, and ordering only matters for formats that share a prefix.
 */
export const ACCEPTED_IMAGE_FORMATS: readonly ImageFormat[] = [
  {
    // 89 50 4E 47 0D 0A 1A 0A - the PNG signature, all eight bytes.
    mime: 'image/png',
    ext: 'png',
    matches: (b) =>
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a
  },
  {
    // FF D8 FF - JPEG start-of-image marker.
    mime: 'image/jpeg',
    ext: 'jpg',
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  },
  {
    mime: 'image/gif',
    ext: 'gif',
    matches: (b) => ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a')
  },
  {
    // RIFF....WEBP - the container tag then the form type four bytes in.
    mime: 'image/webp',
    ext: 'webp',
    matches: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')
  },
  {
    mime: 'image/bmp',
    ext: 'bmp',
    matches: (b) => b[0] === 0x42 && b[1] === 0x4d
  }
]

/** MIME types the client may present in a file input's `accept`. */
export const ACCEPTED_IMAGE_MIME_TYPES: readonly string[] = ACCEPTED_IMAGE_FORMATS.map(
  (f) => f.mime
)

/** The `accept` attribute for an image file input, from the same list. */
export const IMAGE_FILE_ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_MIME_TYPES.join(',')

/**
 * Identifies an image by its content.
 *
 * Returns `null` for anything unrecognised, which the caller must treat as a
 * rejection rather than a fallback: an unknown type is not a type we can serve
 * safely.
 */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  for (const format of ACCEPTED_IMAGE_FORMATS) {
    if (format.matches(bytes)) return format
  }
  return null
}
