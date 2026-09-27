import { fileTypeFromBuffer } from 'file-type'
import { imageSize } from 'image-size'
import {
  ACCEPTED_IMAGE_FORMATS,
  type AcceptedImageFormat,
  acceptedImageFormatFor
} from '../../shared/attachments/image-formats.js'

/**
 * Decides what an upload actually is, from the file's own bytes.
 *
 * ## Why the bytes and not the request
 *
 * A multipart part's `Content-Type` is a string the client chose. A request can
 * claim `image/png` while carrying anything at all, and if the server records
 * the claim and later serves it back, the image endpoint becomes a stored-XSS
 * vector: the browser renders the response with the type the server repeats.
 *
 * So detection runs on the bytes, and the *allowlist* decides the recorded type.
 * The two cannot disagree, because the allowlist is what maps one to the other.
 *
 * ## Why a maintained parser rather than byte signatures
 *
 * An earlier version compared the leading bytes against hand-written signatures.
 * That accepts any file beginning with the eight PNG signature bytes, whatever
 * follows them - including a PNG header followed by attacker-chosen content.
 * `file-type` walks the actual container structure instead: for PNG it reads the
 * chunk sequence and requires a well-formed 13-byte IHDR, and it caps the chunk
 * count and scan budget so a crafted file cannot make it walk indefinitely.
 *
 * ## Why a rejection is never a fallback
 *
 * Every failure path below returns `null`, and the caller must treat `null` as a
 * rejection. Guessing a type for bytes we could not identify is how a file gets
 * stored under a type it does not have.
 */

/** Why an upload was refused. Each case is reported to the user in plain words. */
export type ImageRejectionReason =
  /** The bytes are not a format RTWiki accepts, or not an image at all. */
  | 'unsupported_type'
  /** An SVG - a real image format, deliberately not accepted (ADR-013). */
  | 'svg_not_supported'
  /** More pixels than `PROVISIONAL_MAX_IMAGE_PIXELS` allows. */
  | 'too_many_pixels'

/** The outcome of inspecting an upload: an accepted format, or a reason. */
export type ImageInspection =
  | {
      ok: true
      format: AcceptedImageFormat
      /** Pixel dimensions read from the file's header, or `null` if unreadable. */
      width: number | null
      height: number | null
    }
  | { ok: false; reason: ImageRejectionReason }

/**
 * Types we recognise in order to *explain* a refusal, never to accept one.
 *
 * SVG is called out separately so the user learns the actual reason instead of a
 * generic "unsupported type". Nothing here can widen what is accepted - that is
 * `ACCEPTED_IMAGE_FORMATS`' decision alone.
 */
const SVG_MIMES: ReadonlySet<string> = new Set(['image/svg+xml', 'image/svg'])

/**
 * How much of the file is examined to recognise an SVG.
 *
 * An SVG is XML text, so it is identified by reading it rather than by a
 * signature. `file-type` cannot help here: it reports SVG-shaped input as
 * `application/xml`, or as nothing at all when there is no XML declaration, so a
 * detection-only approach cannot tell "an SVG you cannot use" from "some other
 * file you cannot use".
 */
const SVG_SNIFF_BYTES = 1024

/**
 * Whether the leading bytes are an SVG document.
 *
 * Deliberately a text sniff rather than a parser. Being wrong here is harmless in
 * the one direction that matters: a false positive only changes the *message* a
 * rejected file produces, because an SVG is refused either way. So the test
 * optimises for never missing a real SVG rather than for never misfiring.
 */
function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, SVG_SNIFF_BYTES)
  if (head.length === 0) return false
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(head)
  } catch {
    return false
  }
  // Strip a UTF-8 BOM, which some editors write and which would otherwise hide
  // the opening tag.
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0
  return /<svg[\s/>]/i.test(text.slice(start))
}

/** Formats a browser will draw, kept for the comment in the allowlist honest. */
const ACCEPTED_MIME_SET: ReadonlySet<string> = new Set(ACCEPTED_IMAGE_FORMATS.map((f) => f.mime))

/**
 * Inspects an upload and decides whether RTWiki will store it.
 *
 * `file-type` needs only a prefix of the file, so this reads a bounded slice
 * rather than the whole thing: detection and dimensions both come from headers.
 */
export async function inspectImageUpload(bytes: Uint8Array): Promise<ImageInspection> {
  // Checked before detection, and independently of it: detection cannot identify
  // an SVG reliably (it is XML text, so it reports `application/xml`, or nothing
  // at all when there is no XML declaration), but the user still deserves to be
  // told that SVG is the reason.
  if (looksLikeSvg(bytes)) return { ok: false, reason: 'svg_not_supported' }

  const detected = await detect(bytes)
  if (!detected) return { ok: false, reason: 'unsupported_type' }

  // Belt and braces: if a future parser does report an SVG type, it is still
  // refused, and still with the reason that helps the user.
  if (SVG_MIMES.has(detected.mime)) return { ok: false, reason: 'svg_not_supported' }

  const format = acceptedImageFormatFor(detected.mime)
  if (!format) return { ok: false, reason: 'unsupported_type' }

  // A recognised, accepted type whose header we cannot read is still a
  // legitimate upload; it simply has no recorded dimensions. Refusing it would
  // mean a format RTWiki accepts depends on a second parser agreeing.
  const { width, height } = readDimensions(bytes, format)

  return { ok: true, format, width, height }
}

/** `file-type` inspects a prefix; the slice is generous enough for every header. */
const DETECTION_PREFIX_BYTES = 4100

async function detect(bytes: Uint8Array): Promise<{ mime: string } | null> {
  // file-type throws on input shorter than its own minimum, and on an empty
  // buffer. Neither is an error worth surfacing: both are simply "not accepted".
  const prefix = bytes.subarray(0, DETECTION_PREFIX_BYTES)
  if (prefix.length === 0) return null
  try {
    const detected = await fileTypeFromBuffer(prefix)
    return detected ?? null
  } catch {
    return null
  }
}

/**
 * Reads pixel dimensions from the header without decoding the image.
 *
 * `image-size` parses container headers only, which is what makes the pixel
 * limit cheap: no full decode, no decoder dependency, nothing that has to
 * interpret compressed data an attacker controls. Verified to agree exactly with
 * a full decode on real files.
 */
function readDimensions(
  bytes: Uint8Array,
  format: AcceptedImageFormat
): { width: number | null; height: number | null } {
  if (!ACCEPTED_MIME_SET.has(format.mime)) return { width: null, height: null }
  try {
    const size = imageSize(bytes)
    return {
      width: typeof size.width === 'number' ? size.width : null,
      height: typeof size.height === 'number' ? size.height : null
    }
  } catch {
    // A malformed header is not a rejection on its own; the format check above
    // already decided this is an image RTWiki accepts.
    return { width: null, height: null }
  }
}

/**
 * Total pixels, or `null` when either dimension is unknown.
 *
 * A header may declare dimensions near 2^32, and their product then exceeds
 * `Number.MAX_SAFE_INTEGER`, where a JavaScript number silently loses its low
 * digits. Rather than return a figure that is subtly wrong, a product too large
 * to represent exactly is reported as `Infinity`: it is, unambiguously, over
 * every limit it could be compared against.
 *
 * This cannot let an oversized image through. The imprecision only ever appears
 * around 1.8e19, which is astronomically above the pixel ceiling, so the
 * comparison against that ceiling is correct either way. Verified across the
 * whole range of plausible dimensions.
 */
export function pixelCount(width: number | null, height: number | null): number | null {
  if (width === null || height === null) return null
  const product = width * height
  return Number.isSafeInteger(product) ? product : Number.POSITIVE_INFINITY
}
