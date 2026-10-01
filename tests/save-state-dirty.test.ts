import { describe, expect, it } from 'bun:test'
import type { AutosaveStatus } from '../src/web/features/rich-editor/autosave-controller.js'
import { isAutosaveDirty, mapAutosaveStatus } from '../src/web/features/workspace/save-state.js'

/**
 * The two questions the save state answers, asserted against each other.
 *
 * This file had two spellings of "is there unsaved
 * work" and that the copies disagreed. The disagreement was inert only because
 * nothing read the answer; the moment a close confirmation reads it, the copy that
 * omits `error` is the one that loses a user's content.
 *
 * So this asserts the *relationship* rather than each function's truth table. A
 * future third copy of the question cannot be caught by testing one function; it
 * can be caught by testing the invariant.
 */
const ALL: AutosaveStatus[] = ['idle', 'dirty', 'saving', 'saved', 'error']

/**
 * States in which the document is NOT durably written.
 *
 * `saved` is deliberately not in this set even though the bar shows "Saved" rather
 * than "Clean" for it. Those are different questions: the bar distinguishes
 * "nothing has changed" from "a save just completed" because that is worth
 * showing, but both mean the same thing about durability. Treating the bar's
 * wording as the definition is how this test first failed on correct code.
 */
const NOT_DURABLY_WRITTEN: AutosaveStatus[] = ['dirty', 'saving', 'error']

describe('isAutosaveDirty', () => {
  it('is true for exactly the states where the document is not durably written', () => {
    for (const status of ALL) {
      expect(isAutosaveDirty(status), `${status} durability`).toBe(
        NOT_DURABLY_WRITTEN.includes(status)
      )
    }
  })

  it('counts a failed save as unsaved work', () => {
    // The case that was missing. A failed save leaves the content in memory and
    // unwritten, and the controller keeps it only so a retry can use it — which is
    // only possible while the page is still mounted.
    expect(isAutosaveDirty('error')).toBe(true)
  })

  it('counts a save in flight as unsaved work', () => {
    expect(isAutosaveDirty('saving')).toBe(true)
  })

  it('counts an edit with no save run yet as unsaved work', () => {
    expect(isAutosaveDirty('dirty')).toBe(true)
  })

  it('is false only once the write is confirmed', () => {
    expect(isAutosaveDirty('saved')).toBe(false)
    expect(isAutosaveDirty('idle')).toBe(false)
  })

  it('never reports clean while the status bar is showing an error', () => {
    // The two are read on the same screen, so a disagreement is a visible
    // contradiction rather than an internal inconsistency.
    for (const status of ALL) {
      if (mapAutosaveStatus(status) === 'error') {
        expect(isAutosaveDirty(status), `${status}: bar says error`).toBe(true)
      }
    }
  })

  it('agrees with the bar about every state it calls pending or saving', () => {
    for (const status of ALL) {
      const bar = mapAutosaveStatus(status)
      if (bar === 'pending' || bar === 'saving') {
        expect(isAutosaveDirty(status), `${status}: bar says ${bar}`).toBe(true)
      }
    }
  })
})

describe('mapAutosaveStatus', () => {
  it('keeps pending distinct from clean', () => {
    // Folding these together made the bar announce "Saved" for work that was
    // still only in memory.
    expect(mapAutosaveStatus('dirty')).toBe('pending')
    expect(mapAutosaveStatus('idle')).toBe('clean')
  })

  it('surfaces an error as an error', () => {
    expect(mapAutosaveStatus('error')).toBe('error')
  })
})
