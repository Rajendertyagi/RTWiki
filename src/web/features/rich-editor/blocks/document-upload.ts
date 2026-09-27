import { notifications } from '@mantine/notifications'
import { PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES } from '@rtwiki/shared/constants'
import { UI_TEXT } from '../../../config/index.js'

/**
 * Uploads one document and returns the URL the browser should offer it from.
 *
 * Mirrors `uploadImage` on purpose: one request shape, one set of failure
 * messages, and no second code path for a paste or a drop to diverge from. The
 * two differ only in what they are called and what the user is told.
 *
 * ## What it deliberately does not do
 *
 * It does not check the file's type before sending, and it does not build a
 * `data:` URL as a fallback. Both would be a second, weaker copy of rules the
 * server already enforces from the file's own bytes. The one check kept here is
 * the size limit, and only to spare the user a pointless wait — the server
 * rejects it regardless.
 */
export async function uploadDocument(file: File): Promise<string> {
  try {
    return await postDocument(file)
  } catch (err) {
    const message = err instanceof Error ? err.message : UI_TEXT.documentUploadFailed
    notifications.show({
      title: UI_TEXT.documentUploadFailedTitle,
      message,
      color: 'red',
      autoClose: 8000
    })
    throw err instanceof Error ? err : new Error(message)
  }
}

async function postDocument(file: File): Promise<string> {
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
    // A network-level failure says nothing about the file, so it gets the same
    // plain message as a rejection rather than a technical one.
    throw new Error(UI_TEXT.documentUploadFailed)
  }

  if (!response.ok) {
    throw new Error(messageForStatus(response.status, await readErrorCode(response)))
  }

  // The response shape is the server's, so it is checked rather than assumed: an
  // unreadable reply must not become a broken link in the document.
  const payload: unknown = await response.json().catch(() => null)
  const url = readAttachmentUrl(payload)
  if (!url) throw new Error(UI_TEXT.documentUploadFailed)
  return url
}

/** Picks the message for a failed upload, from the server's reason code. */
function messageForStatus(status: number, code: string | null): string {
  if (code === 'svg_not_supported') return UI_TEXT.imageSvgNotSupported
  if (code === 'too_many_pixels') return UI_TEXT.imageTooManyPixels
  if (code === 'unsupported_type') return UI_TEXT.attachmentUnsupportedType
  if (status === 413) return UI_TEXT.imageTooLarge
  return UI_TEXT.documentUploadFailed
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
  return typeof url === 'string' && url.length > 0 ? url : null
}
