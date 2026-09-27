import { DOCUMENT_FILE_ACCEPT_ATTRIBUTE } from '../../../../shared/attachments/document-formats.js'

/**
 * Opens the OS file picker for a single document and resolves with the choice.
 *
 * The same shape as `pickImage`, and deliberately so: the two differ only in the
 * list of accepted types. Anything that changes how a picker is created, awaited
 * and cleaned up has to change in both places, which is why the shared logic
 * lives in one function rather than being written twice.
 */

/**
 * How long after the window regains focus to conclude the dialog was dismissed.
 *
 * Long enough for the change event to arrive first on a slow machine, short
 * enough that a genuine pick is never reported as a cancellation.
 */
const CANCEL_GRACE_MS = 500

export function pickDocument(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    // Derived from the same list the server enforces, so the picker and the
    // server cannot drift apart. Extensions are included as well as types
    // because a signature-less format (.txt, .md) is only identifiable by its
    // extension, and a file input filters far more usefully on both.
    input.accept = DOCUMENT_FILE_ACCEPT_ATTRIBUTE
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

    // Not every browser reports a dismissal, so the window regaining focus is
    // the backstop. It is deferred so it cannot win the race against `change`,
    // which is dispatched before focus returns.
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
