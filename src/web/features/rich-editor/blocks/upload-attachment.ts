import { uploadDocument } from './document-upload.js'
import { uploadImage } from './image-upload.js'

/**
 * The single upload hook BlockNote calls for paste, drop and its own file picker.
 *
 * ## Why this dispatches instead of calling one uploader
 *
 * BlockNote passes this one function a `File` and gets back a URL, with no
 * per-block routing. Pointing it straight at `uploadImage` meant a **dropped PDF
 * was reported as an image failure** - "That image could not be added. Try a PNG,
 * JPEG..." - which is both factually wrong and tells the user nothing about what
 * to do instead. The user had no way to tell a rejected document from a rejected
 * image.
 *
 * ## What the dispatch decides, and what it does not
 *
 * It chooses only *which uploader owns the failure message*. Both post to the
 * same endpoint with the same field name and the same size check; they differ
 * only in the words the user reads. **Acceptance is not decided here.** The server
 * identifies the file from its own bytes and refuses whatever it does not
 * recognise, so a mis-routed file is still refused - it is simply explained
 * correctly.
 *
 * The browser's reported type is used for that choice because it is the only
 * signal available at this point, and it is the wrong one to trust for anything
 * that matters. It is not used for anything that matters.
 *
 * ## Why not one shared uploader instead
 *
 * That would be the smaller change in lines and the wrong shape: the two
 * messages are genuinely different products, and merging them would put a
 * `kind` parameter through a function whose job is to upload a file. Two thin
 * wrappers over one request, with the wording beside the wrapper, keeps the
 * request single and the language honest.
 *
 * ## What the caller must handle
 *
 * Both uploaders report their own failure and rethrow, so this rejects and the
 * caller is responsible only for restoring its own state. See `image-upload.ts`,
 * which explains why the message lives here rather than with the caller.
 */
export function uploadAttachment(file: File): Promise<string> {
  return looksLikeImage(file) ? uploadImage(file) : uploadDocument(file)
}

/**
 * Whether to explain a failure in image words or document words.
 *
 * Deliberately a *reported*-type test and nothing more. It must not become an
 * acceptance test, an allowlist, or a second copy of the server's format rules:
 * those already exist and are enforced from the bytes.
 */
function looksLikeImage(file: File): boolean {
  return file.type.startsWith('image/')
}
