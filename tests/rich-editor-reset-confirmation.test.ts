import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { UI_TEXT } from '../src/web/config/index.js'
import { sharedDom } from './utils/dom-harness.js'

/**
 * The crash-recovery screen once offered a single "Reset document" click that
 * replaced the page's stored content with an empty document. RTWiki keeps no
 * backup copy of page content (ADR-018), so that click was permanent
 * unrecoverable deletion presented directly under a message assuring the user
 * their content was safe.
 *
 * These tests mount the real `EditorErrorBoundary` in jsdom and drive its real
 * buttons, because the defect was in the *wiring* between the control and the
 * destructive callback — a dictionary test, or a test that only read the
 * strings, would have passed while the button was still one click away.
 *
 * ## Why the DOM is the shared one, and never closed
 *
 * This file used to build its own `new JSDOM()` and call `dom.window.close()` in
 * `afterAll`, which is a live hazard rather than a tidy teardown. `markdown-render.ts`
 * creates its DOMPurify instance **at import time**, bound to whatever `window`
 * is ambient then; ESM caches a module for the life of the process, so that
 * binding is made exactly once and every later file inherits it. A file that
 * closes its own window therefore pulls the document out from under the
 * sanitiser for every file that runs after it — measured at 26 pre-existing
 * failures, every one of them a null or empty result from a sanitiser whose
 * document had been closed underneath it.
 *
 * Nothing collided, only because this file does not import `markdown-render`.
 * That is one incidental import away from a red suite in a file that has nothing
 * to do with the change. So the DOM is the shared one, and `afterAll` no longer
 * closes anything. `utils/dom-harness.ts` carries the full reasoning.
 */

let dom: ReturnType<typeof sharedDom>
let boundaryModule: typeof import('../src/web/features/rich-editor/editor-error-boundary.js')

/** Installed before the module import: Mantine reads the ambient document. */
beforeAll(async () => {
  // Creates the process-wide DOM on first use and installs `window`, `document`
  // and the node constructors. Only the globals this file alone needs are set
  // here, so that ownership stays visible rather than duplicated.
  dom = sharedDom()
  const globals = globalThis as unknown as Record<string, unknown>
  globals.Event = dom.window.Event
  globals.MouseEvent = dom.window.MouseEvent
  globals.navigator = dom.window.navigator
  globals.IS_REACT_ACT_ENVIRONMENT = true
  console.error = () => {}
  boundaryModule = await import('../src/web/features/rich-editor/editor-error-boundary.js')
})

afterAll(() => {
  // Only the console is restored. The DOM globals are deliberately left alone:
  // they are the shared harness's now, and deleting them would break every file
  // that runs after this one — the exact failure mode this file used to cause
  // by closing the window instead.
  console.error = realConsoleError
})

/**
 * React logs every error a boundary catches. That noise is not a test signal
 * and would bury a real failure, so it is muted for this file only and restored
 * on teardown.
 */
const realConsoleError = console.error

interface Harness {
  /** Re-renders the boundary over children that throw, forcing the crash screen. */
  crash: (props: { onReset: () => void; onRetry?: () => void; onBack?: () => void }) => void
  cleanup: () => void
  doc: () => Document
  byTestId: (id: string) => Element | null
  click: (id: string) => void
  clickByLabel: (label: string) => void
}

async function mountHarness(): Promise<Harness> {
  const React = await import('react')
  const { act } = React as unknown as { act: (callback: () => void) => void }
  const { MantineProvider } = await import('@mantine/core')
  const { createRoot } = await import('react-dom/client')
  const { EditorErrorBoundary } = boundaryModule

  const container = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(container)
  const root = createRoot(container)

  function Explode(): React.ReactNode {
    throw new Error('simulated editor failure')
  }

  const doc = (): Document => dom.window.document
  const harness: Harness = {
    crash: (props) => {
      act(() => {
        root.render(
          React.createElement(
            MantineProvider,
            null,
            React.createElement(EditorErrorBoundary, {
              ...props,
              children: React.createElement(Explode)
            })
          )
        )
      })
    },
    cleanup: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
    doc,
    // Scoped to this harness's container so a leftover root from another test
    // can never satisfy a lookup.
    byTestId: (id) => container.querySelector(`[data-testid="${id}"]`),
    click: (id) => {
      const el = harness.byTestId(id)
      if (!el) throw new Error(`no element with data-testid="${id}"`)
      act(() => {
        el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
      })
    },
    clickByLabel: (label) => {
      const button = [...container.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === label
      )
      if (!button) throw new Error(`no button labelled "${label}"`)
      act(() => {
        button.dispatchEvent(
          new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
        )
      })
    }
  }
  return harness
}

describe('Rich Note crash recovery cannot delete content in one click', () => {
  it('arms a confirmation instead of resetting on the first click', async () => {
    let resets = 0
    const ui = await mountHarness()
    ui.crash({ onReset: () => (resets += 1) })

    // The single click that used to overwrite the page.
    ui.clickByLabel(UI_TEXT.richEditorResetButton)

    expect(resets).toBe(0)
    expect(ui.byTestId('reset-confirmation')).not.toBeNull()
    ui.cleanup()
  })

  it('leaves the page untouched when the confirmation is cancelled', async () => {
    let resets = 0
    let retries = 0
    const ui = await mountHarness()
    ui.crash({ onReset: () => (resets += 1), onRetry: () => (retries += 1) })

    ui.clickByLabel(UI_TEXT.richEditorResetButton)
    ui.click('reset-confirm-cancel')

    expect(resets).toBe(0)
    // Cancelling must also disarm: the plain reset control is back, and pressing
    // it again still cannot delete anything.
    expect(ui.byTestId('reset-confirmation')).toBeNull()
    expect(ui.byTestId('reset-request')).not.toBeNull()
    ui.clickByLabel(UI_TEXT.richEditorResetButton)
    expect(resets).toBe(0)
    expect(retries).toBe(0)
    ui.cleanup()
  })

  it('resets only once the confirmation is confirmed', async () => {
    let resets = 0
    const ui = await mountHarness()
    ui.crash({ onReset: () => (resets += 1) })

    ui.clickByLabel(UI_TEXT.richEditorResetButton)
    ui.click('reset-confirm-apply')

    expect(resets).toBe(1)
    ui.cleanup()
  })

  it('disarms the confirmation when Retry is chosen instead', async () => {
    let resets = 0
    let retries = 0
    const ui = await mountHarness()
    ui.crash({
      onReset: () => (resets += 1),
      onRetry: () => (retries += 1),
      onBack: () => {}
    })

    ui.clickByLabel(UI_TEXT.richEditorResetButton)
    ui.clickByLabel(UI_TEXT.retry)

    expect(retries).toBe(1)
    expect(resets).toBe(0)
    ui.cleanup()
  })

  it('disarms the confirmation when the user navigates away instead', async () => {
    let resets = 0
    let backs = 0
    const ui = await mountHarness()
    ui.crash({
      onReset: () => (resets += 1),
      onBack: () => (backs += 1)
    })

    ui.clickByLabel(UI_TEXT.richEditorResetButton)
    ui.clickByLabel(UI_TEXT.backToDashboard)

    expect(backs).toBe(1)
    expect(resets).toBe(0)
    ui.cleanup()
  })

  it('states in the confirmation that the content is replaced and unrecoverable', async () => {
    const ui = await mountHarness()
    ui.crash({ onReset: () => {} })
    ui.clickByLabel(UI_TEXT.richEditorResetButton)

    const warning = ui.byTestId('reset-confirmation')?.textContent ?? ''
    expect(warning).toContain(UI_TEXT.richEditorResetConfirmWarning)
    expect(UI_TEXT.richEditorResetConfirmWarning).toMatch(/replace/i)
    expect(UI_TEXT.richEditorResetConfirmWarning).toMatch(/cannot be recovered|recovered/i)
    expect(UI_TEXT.richEditorResetConfirmWarning).toMatch(/no backup copy/i)
    ui.cleanup()
  })
})

describe('Rich Note recovery screens no longer claim the content is preserved', () => {
  /**
   * Asserts the *absence* of a false assurance rather than exact wording, so
   * the copy can be rewritten freely — but it must never again tell a user
   * sitting above a one-click deletion that their content is safe.
   */
  const FALSE_ASSURANCES = [
    /content (?:is|has been) (?:safe|preserved)/i,
    /preserved/i,
    /is safe\b/i
  ]

  it('crash message does not assert the content is safe', () => {
    for (const pattern of FALSE_ASSURANCES) {
      expect(UI_TEXT.richEditorCrashMessage).not.toMatch(pattern)
    }
  })

  it('neither recovery notice asserts the content is preserved', () => {
    for (const pattern of FALSE_ASSURANCES) {
      expect(UI_TEXT.richEditorParseRecoveryNotice).not.toMatch(pattern)
      expect(UI_TEXT.richEditorCrashRecoveryNotice).not.toMatch(pattern)
    }
  })

  it('both notices say what the reset control will do', () => {
    for (const notice of [
      UI_TEXT.richEditorParseRecoveryNotice,
      UI_TEXT.richEditorCrashRecoveryNotice
    ]) {
      expect(notice).toContain(UI_TEXT.richEditorResetButton)
      expect(notice).toMatch(/cannot be recovered/i)
    }
  })

  it('every dictionary entry is a plain string, so value-iterating consumers hold', () => {
    // The house rule: `UI_TEXT` is iterated wholesale by consumers, so it must
    // never hold a function or an element.
    for (const [key, value] of Object.entries(UI_TEXT)) {
      expect(typeof value, `${key} is not a plain string`).toBe('string')
    }
  })
})
