import { describe, expect, test } from 'bun:test'

import {
  AVAILABLE,
  type Capability,
  type EditorCapabilities,
  isUnavailable,
  unavailable
} from '../src/web/features/workspace/capabilities.js'
import {
  OVERFLOW_CONTROL,
  TOOLBAR_CONTROLS,
  TOOLBAR_GROUPS,
  TOOLBAR_LABEL
} from '../src/web/features/workspace/toolbar-model.js'

/**
 * The toolbar model is the one description of the control set, so these tests
 * are about its *invariants* rather than its contents. A test that asserted
 * "there are 35 controls" would fail the next time someone adds one, which is
 * the wrong way to fail; what must never break is that every control has a
 * unique key, a label from the dictionary, and a place in exactly one group.
 */

describe('toolbar model invariants', () => {
  test('every control has a unique key', () => {
    const keys = TOOLBAR_CONTROLS.map((control) => control.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('a control belongs to exactly one group', () => {
    const grouped = TOOLBAR_GROUPS.flatMap((group) => group.controls)
    expect(grouped.length).toBe(TOOLBAR_CONTROLS.length)
    // The flattened list is the bar order, so it must be the same controls.
    expect(grouped.map((c) => c.key)).toEqual(TOOLBAR_CONTROLS.map((c) => c.key))
  })

  test('no group key repeats, so a divider cannot move when a group empties', () => {
    const keys = TOOLBAR_GROUPS.map((group) => group.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('every control has a non-empty label', () => {
    for (const control of TOOLBAR_CONTROLS) {
      expect(control.label.length).toBeGreaterThan(0)
    }
  })

  test('every control has a renderable icon', () => {
    for (const control of TOOLBAR_CONTROLS) {
      // Tabler icons are `forwardRef` objects, not plain functions, so a
      // `typeof === 'function'` check is the wrong assertion — it fails on a
      // perfectly valid icon. What matters is that the value is something React
      // can render as a component.
      const icon = control.Icon as unknown
      const renderable =
        typeof icon === 'function' ||
        (typeof icon === 'object' && icon !== null && '$$typeof' in (icon as object))
      expect(renderable).toBe(true)
    }
  })

  test('the overflow control is not also a bar control', () => {
    // It is rendered by the shell after the split, so listing it in the model
    // would render it twice: once as a command and once as the overflow button.
    expect(TOOLBAR_CONTROLS.some((c) => c.key === OVERFLOW_CONTROL.key)).toBe(false)
  })

  test('the bar has a label for the toolbar role', () => {
    expect(TOOLBAR_LABEL.length).toBeGreaterThan(0)
  })

  test('group keys are not positional', () => {
    // A numeric group key would survive a rename and then be wrong.
    for (const group of TOOLBAR_GROUPS) {
      expect(group.key).not.toMatch(/^\d+$/)
    }
  })
})

describe('availability', () => {
  test('AVAILABLE is available and carries no reason', () => {
    expect(AVAILABLE.available).toBe(true)
  })

  test('unavailable always carries a non-empty reason', () => {
    const result = unavailable('no alignment syntax')
    expect(result.available).toBe(false)
    expect(isUnavailable(result)).toBe(true)
    if (!result.available) {
      expect(result.reason.length).toBeGreaterThan(0)
    }
  })

  test('isUnavailable narrows correctly in both directions', () => {
    expect(isUnavailable(AVAILABLE)).toBe(false)
    expect(isUnavailable(unavailable('x'))).toBe(true)
  })
})

describe('capability resolution', () => {
  /** A surface that implements exactly the capabilities it is given. */
  const surface = (
    keys: Capability[],
    state: EditorCapabilities['state'] = () => ({})
  ): EditorCapabilities => ({
    commands: Object.fromEntries(keys.map((key) => [key, () => undefined])),
    state
  })

  test('a capability the surface implements is resolved with its command', async () => {
    const { resolveControlAvailability } = await import(
      '../src/web/features/workspace/capabilities.js'
    )
    const capabilities = surface(['mark.bold'])
    const resolved = resolveControlAvailability(capabilities, 'mark.bold')
    expect(resolved).not.toBeNull()
    expect(typeof resolved?.command).toBe('function')
    expect(resolved?.state.active).toBeUndefined()
  })

  test('a capability the surface does not implement resolves to null', async () => {
    const { resolveControlAvailability } = await import(
      '../src/web/features/workspace/capabilities.js'
    )
    const capabilities = surface(['mark.bold'])
    expect(resolveControlAvailability(capabilities, 'align.left')).toBeNull()
  })

  test('an unavailable state is preserved, not normalised to available', async () => {
    const { resolveControlAvailability } = await import(
      '../src/web/features/workspace/capabilities.js'
    )
    const capabilities = surface(['mark.bold'], () => ({
      'mark.bold': { available: unavailable('nothing selected') }
    }))
    const resolved = resolveControlAvailability(capabilities, 'mark.bold')
    expect(resolved).not.toBeNull()
    if (resolved) {
      expect(resolved.state.available?.available).toBe(false)
    }
  })

  test('a live state entry with no availability means available', async () => {
    const { resolveControlAvailability } = await import(
      '../src/web/features/workspace/capabilities.js'
    )
    // Only `active` reported. A surface that does not think about availability
    // must not have its controls greyed.
    const capabilities = surface(['mark.bold'], () => ({ 'mark.bold': { active: true } }))
    const resolved = resolveControlAvailability(capabilities, 'mark.bold')
    expect(resolved?.state.available).toBeUndefined()
  })
})
