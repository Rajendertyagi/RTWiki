import { notifications } from '@mantine/notifications'
import { PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES } from '@rtwiki/shared/constants'
import { UI_TEXT } from '../../../config/index.js'

/**
 * Uploads one image and returns the URL to store in the block.
 *
 * This is the single client entry point for images. BlockNote calls it for the
 * file picker, for paste and for drop, so all three go through one request shape
 * and one set of failure messages - there is no second path to keep in step.
 *
 * ## Why failures are reported here and not by the caller
 *
 * Paste and drop are handled inside BlockNote, not by RTWiki, so a caller-owned
 * error message would only ever appear for the Insert-menu route. Reporting from
 * this function means a rejected image is explained no matter which route
 * produced it. The error is still rethrown so the caller can restore its own
 * state; it is only the *message* that is owned centrally.
 *
 * ## What it deliberately does not do
 *
 * It does not check the file's type before sending, and it does not build a
 * `data:` URL as a fallback. Both would be a second, weaker copy of rules the
 * server already enforces from the file's actual bytes: the browser only knows
 * the declared type, which is the very thing that cannot be trusted. The one
 * check kept here is the size limit, and only to spare the user a pointless wait
 * - the server rejects it regardless.
 */
export async function uploadImage(file: File): Promise<string> {
  try {
    return await postImage(file)
  } catch (err) {
    const message = err instanceof Error ? err.message : UI_TEXT.imageUploadFailed
    notifications.show({
      title: UI_TEXT.imageUploadFailedTitle,
      message,
      color: 'red',
      autoClose: 8000
    })
    throw err instanceof Error ? err : new Error(message)
  }
}

async function postImage(file: File): Promise<string> {
  // Reported locally for a fast, friendly failure. The authoritative limit lives
  // in the shared constants, so the two cannot drift apart.
  if (file.size > PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error(UI_TEXT.imageTooLarge)
  }

  const body = new FormData()
  // The field name is the server's contract.
  body.append('file', file, file.name)

  let response: Response
  try {
    response = await fetch('/api/attachments', { method: 'POST', body })
  } catch {
    // A network-level failure says nothing about the image, so it gets the same
    // plain message as a rejection rather than a technical one.
    throw new Error(UI_TEXT.imageUploadFailed)
  }

  if (!response.ok) {
    throw new Error(messageForStatus(response.status, await readErrorCode(response)))
  }

  // The response shape is the server's, so it is checked rather than assumed: an
  // unreadable reply must not become an `<img src="undefined">` in the document.
  const payload: unknown = await response.json().catch(() => null)
  const url = readAttachmentUrl(payload)
  if (!url) throw new Error(UI_TEXT.imageUploadFailed)
  return url
}

/**
 * Picks the message for a failed upload.
 *
 * The server distinguishes why it refused an upload, and the two reasons a user
 * can actually act on - an SVG, and too many pixels - get their own words rather
 * than a generic failure. A reason code is preferred over the status because the
 * status alone cannot tell those two apart.
 */
function messageForStatus(status: number, code: string | null): string {
  if (code === 'svg_not_supported') return UI_TEXT.imageSvgNotSupported
  if (code === 'too_many_pixels') return UI_TEXT.imageTooManyPixels
  if (status === 413) return UI_TEXT.imageTooLarge
  return UI_TEXT.imageUploadFailed
}

/**
 * Reads the server's reason code, if it sent one.
 *
 * The body is consumed here so the caller does not read it twice; a body that is
 * absent or unreadable simply yields `null`, which falls back to the status.
 */
async function readErrorCode(response: Response): Promise<string | null> {
  const payload: unknown = await response.json().catch(() => null)
  if (typeof payload !== 'object' || payload === null) return null
  const code = (payload as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

/** Pulls the stored URL out of the upload response, or null if it is not there. */
function readAttachmentUrl(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const attachment = (payload as { attachment?: unknown }).attachment
  if (typeof attachment !== 'object' || attachment === null) return null
  const url = (attachment as { url?: unknown }).url
  if (typeof url !== 'string' || url.length === 0) return null
  return url
}
