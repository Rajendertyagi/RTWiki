/**
 * The image formats RTWiki accepts — the single source of truth for that list.
 *
 * ## This module is the policy, not the parser
 *
 * It answers one question: *which formats are allowed, and what are they called?*
 * It deliberately does **not** inspect bytes. Deciding what a file actually is
 * happens server-side in `src/server/attachments/image-detect.ts`, which reads
 * the file's own bytes and then looks the answer up here.
 *
 * The split is deliberate:
 *
 * - This file has **no dependencies** and is imported by the browser (the file
 *   picker's `accept` attribute), so nothing here may pull in a Node-only
 *   module.
 * - Detection needs a maintained parser. Hand-rolling byte signatures meant we
 *   accepted *any* file beginning with the eight PNG signature bytes, whatever
 *   followed them. `file-type` walks the real container structure instead.
 *
 * ## Why the client's declared type is never trusted
 *
 * A multipart part's `Content-Type` is attacker-controlled: a request can claim
 * `image/png` while carrying anything at all. Trusting it is how an image
 * endpoint becomes a cross-site-scripting vector — the server stores the file,
 * hands back a URL, and the browser renders it with whatever type the server
 * repeats back. So the type is decided by the file's own bytes, and it is the
 * only type ever recorded or served.
 *
 * ## Why SVG is deliberately not accepted
 *
 * SVG is XML that can carry `<script>`, event handlers and external references.
 * Serving one inline is document execution, which the security model forbids for
 * uploaded content ("no execution of uploaded documents; serve attachments as
 * static content only"). Excluding it is simpler and safer than maintaining a
 * parser-level allowlist against a format designed to be extensible, and it
 * costs a format nobody pastes into a study note. A note can still link to an
 * SVG hosted elsewhere. See ADR-013.
 */

/** An image format RTWiki accepts, named by the type RTWiki itself assigns. */
export interface AcceptedImageFormat {
  /**
   * The only type recorded and served for this format.
   *
   * This is our value, never the uploader's. It doubles as the key the
   * detector looks up once it has decided what the bytes really are.
   */
  readonly mime: string
  /** The extension used in the stored filename, chosen by us for the same reason. */
  readonly ext: string
}

/**
 * Formats accepted for upload.
 *
 * AVIF is here because it decodes in every current browser and is markedly
 * smaller than JPEG at the same quality. It is stored untouched — RTWiki accepts
 * and serves images, it does not re-encode them — so no decoder is needed for it.
 *
 * TIFF, HEIC and JPEG XL are deliberately absent even though `file-type` detects
 * all three:
 *
 * - **TIFF** renders in Safari only, so a note containing one shows a broken
 *   image everywhere else.
 * - **HEIC** is unsupported by every current desktop browser.
 * - **JPEG XL** is unsupported by Chrome, Edge and Firefox.
 *
 * Accepting a format most readers cannot display would be worse than refusing
 * it, because the failure looks like data loss to the user.
 */
export const ACCEPTED_IMAGE_FORMATS: readonly AcceptedImageFormat[] = [
  { mime: 'image/png', ext: 'png' },
  { mime: 'image/jpeg', ext: 'jpg' },
  { mime: 'image/gif', ext: 'gif' },
  { mime: 'image/webp', ext: 'webp' },
  { mime: 'image/avif', ext: 'avif' },
  { mime: 'image/bmp', ext: 'bmp' }
]

/** Fast lookup from a detected type to the format RTWiki stores. */
const ACCEPTED_BY_MIME: ReadonlyMap<string, AcceptedImageFormat> = new Map(
  ACCEPTED_IMAGE_FORMATS.map((format) => [format.mime, format])
)

/** MIME types the client may present in a file input's `accept`. */
export const ACCEPTED_IMAGE_MIME_TYPES: readonly string[] = ACCEPTED_IMAGE_FORMATS.map(
  (f) => f.mime
)

/** The `accept` attribute for an image file input, from the same list. */
export const IMAGE_FILE_ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_MIME_TYPES.join(',')

/**
 * A detected type RTWiki will accept, or `null` if it is not on the list.
 *
 * The detector supplies the *evidence*; this list supplies the *decision*. A
 * type that is detected but absent here is refused, so widening what RTWiki
 * accepts is always a deliberate edit to `ACCEPTED_IMAGE_FORMATS`.
 */
export function acceptedImageFormatFor(
  mime: string | null | undefined
): AcceptedImageFormat | null {
  if (!mime) return null
  return ACCEPTED_BY_MIME.get(mime) ?? null
}
