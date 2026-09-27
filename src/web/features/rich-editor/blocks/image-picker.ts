import { IMAGE_FILE_ACCEPT_ATTRIBUTE } from '../../../../shared/attachments/image-formats.js'

/**
 * Opens the OS file picker for a single image and resolves with the chosen file.
 *
 * ## Why the input is created and discarded each time
 *
 * A file input keeps its selection after a change, so a long-lived element
 * reused for a second pick would silently resolve with the *previous* image. A
 * fresh element per request removes that class of bug entirely.
 *
 * ## Why a promise rather than a callback
 *
 * The caller has to wait for a human, across an await, before it knows where to
 * put the result. Encoding that as a promise keeps the flow linear and makes the
 * "user cancelled" case an ordinary `null` rather than a callback nobody calls.
 */
export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    // The accepted list is derived from the formats the server will detect, so
    // the picker and the server cannot drift apart.
    input.accept = IMAGE_FILE_ACCEPT_ATTRIBUTE
    input.style.display = 'none'

    // Fires only on an actual selection, so there is no settled-twice risk here;
    // the cancel path below is the only other exit.
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0] ?? null
        cleanup()
        resolve(file)
      },
      { once: true }
    )

    // Not every browser reports a dismissal, so the window regaining focus is the
    // backstop. It is deferred so it cannot win the race against `change`, which
    // is dispatched before focus returns.
    const onFocusBack = (): void => {
      window.setTimeout(() => {
        if (input.files === null || input.files.length === 0) {
          cleanup()
          resolve(null)
        }
      }, CANCEL_GRACE_MS)
    }
    window.addEventListener('focus', onFocusBack, { once: true })

    function cleanup(): void {
      window.removeEventListener('focus', onFocusBack)
      input.remove()
    }

    document.body.append(input)
    input.click()
  })
}

/**
 * How long after the window regains focus to conclude the dialog was dismissed.
 *
 * Long enough for the change event to arrive first on a slow machine, short
 * enough that a genuine pick is never reported as a cancellation.
 */
const CANCEL_GRACE_MS = 500
