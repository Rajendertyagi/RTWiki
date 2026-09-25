import { describe, expect, test } from 'bun:test'
import {
  isAutosaveDirty,
  mapAutosaveStatus,
  type StatusSaveState
} from '../src/web/features/workspace/save-state.js'

/**
 * The mapping is the single point where "the autosave lifecycle" becomes "what
 * the status bar says". It existed in three drifting copies, and two of them
 * reported unsaved work as saved. These tests exist so a fourth copy cannot
 * appear, and so a future edit to this function has to be deliberate.
 */
describe('mapAutosaveStatus', () => {
  test("'dirty' is pending, never clean", () => {
    // The regression that mattered. Autosave is debounced, so between an edit
    // and the save there is a window where the work exists only in memory.
    // Reporting that as 'clean' made the bar say "Saved" for unsaved work.
    expect(mapAutosaveStatus('dirty')).toBe('pending')
    expect(mapAutosaveStatus('dirty')).not.toBe('clean')
  })

  test("'idle' is clean", () => {
    expect(mapAutosaveStatus('idle')).toBe('clean')
  })

  test('each autosave status maps to a distinct, expected display state', () => {
    const table: Array<[Parameters<typeof mapAutosaveStatus>[0], StatusSaveState]> = [
      ['idle', 'clean'],
      ['dirty', 'pending'],
      ['saving', 'saving'],
      ['saved', 'saved'],
      ['error', 'error']
    ]
    for (const [input, expected] of table) {
      expect(mapAutosaveStatus(input)).toBe(expected)
    }
  })

  test('every display state is reachable', () => {
    // A state the bar can render but nothing produces is dead code; a state the
    // bar cannot render falls through to "Saved", which is the original defect.
    const reachable = new Set<StatusSaveState>()
    for (const s of ['idle', 'dirty', 'saving', 'saved', 'error'] as const) {
      reachable.add(mapAutosaveStatus(s))
    }
    expect([...reachable].sort()).toEqual(['clean', 'error', 'pending', 'saved', 'saving'])
  })
})

describe('isAutosaveDirty', () => {
  test('an edit awaiting its save counts as dirty', () => {
    expect(isAutosaveDirty('dirty')).toBe(true)
  })

  test('a save in flight counts as dirty, so closing still prompts', () => {
    expect(isAutosaveDirty('saving')).toBe(true)
  })

  test('nothing outstanding is not dirty', () => {
    expect(isAutosaveDirty('idle')).toBe(false)
    expect(isAutosaveDirty('saved')).toBe(false)
  })

  test('agrees with the display state: anything the bar calls unsaved is dirty', () => {
    // The close/switch confirmation and the status bar must not disagree about
    // whether work is outstanding.
    for (const s of ['idle', 'dirty', 'saving', 'saved', 'error'] as const) {
      const shown = mapAutosaveStatus(s)
      const unsaved = shown === 'pending' || shown === 'saving'
      if (s !== 'error') {
        expect(isAutosaveDirty(s), `status=${s} shown=${shown}`).toBe(unsaved)
      }
    }
  })
})
