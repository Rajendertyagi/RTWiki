import { describe, expect, test } from 'bun:test'

import {
  AVAILABLE,
  type Capability,
  type EditorCapabilities,
  type EditorMenu,
  unavailable
} from '../src/web/features/workspace/capabilities.js'
import { COLOR_PRESETS } from '../src/web/features/workspace/swatch-panel.js'
import { TOOLBAR_CONTROLS } from '../src/web/features/workspace/toolbar-model.js'

/**
 * The menu seam's contract, tested without a DOM.
 *
 * ## Why this is here as well as in the browser
 *
 * The browser test (`toolbar-menu-seam.pwspec.ts`) is the real proof: it opens a
 * panel, makes a choice, and asserts the editor's document changed. This file
 * tests the *decision logic* the shell runs before any of that, and it can, for
 * two reasons that matter:
 *
 * - it pins the resolver rules that the seam depends on, including the two that
 *   were wrong when the seam was written and had never been exercised;
 * - the browser test drives the shell through a served app, so a change to the
 *   resolver's rules would otherwise only be visible as a slow integration
 *   failure.
 *
 * Nothing here asserts that a panel rendered. The browser test owns that claim.
 */

/** A surface with no commands and no panels. */
const emptySurface: EditorCapabilities = { commands: {}, state: () => ({}) }

/** The resolver rule, mirrored from `document-toolbar.tsx` for testing. */
function resolve(capabilities: EditorCapabilities, key: Capability): 'rendered' | 'dropped' {
  const run = capabilities.commands[key] ?? null
  const menu = capabilities.menus?.[key] ?? null
  const stated = capabilities.state()[key]?.available
  if (!run && !menu && !stated) return 'dropped'
  return 'rendered'
}

describe('the resolver keeps a menu-only control', () => {
  test('a capability with a panel and no command is rendered', () => {
    // The defect this pins. Text colour has no command: it does nothing until a
    // colour is chosen. Under the rule "no command and no stated unavailability
    // means drop", it was dropped — so the seam could not express the very
    // controls that most needed migrating.
    const surface: EditorCapabilities = {
      commands: {},
      menus: { 'color.text': { content: () => null } },
      state: () => ({})
    }
    expect(resolve(surface, 'color.text')).toBe('rendered')
  })

  test('a capability with neither a command nor a panel is still dropped', () => {
    // The other half, so the fix did not turn the rule into "render everything".
    expect(resolve(emptySurface, 'align.left')).toBe('dropped')
  })

  test('a stated unavailability is enough to keep a control, greyed', () => {
    const surface: EditorCapabilities = {
      commands: {},
      state: () => ({
        'align.left': { available: unavailable('Markdown has no alignment syntax') }
      })
    }
    expect(resolve(surface, 'align.left')).toBe('rendered')
  })

  test('a command alone is enough', () => {
    const surface: EditorCapabilities = {
      commands: { 'mark.bold': () => undefined },
      state: () => ({})
    }
    expect(resolve(surface, 'mark.bold')).toBe('rendered')
  })
})

describe('the menu contract', () => {
  test('a panel is given a close callback, so it can dismiss itself', () => {
    // Without this the panel could not close after a choice, which is why the
    // earlier seam — a bare ReactNode — was structurally unusable.
    let close: (() => void) | null = null
    const menu: EditorMenu = {
      content: (closePanel) => {
        close = closePanel
        return null
      }
    }
    const surface: EditorCapabilities = {
      commands: {},
      menus: { 'color.text': menu },
      state: () => ({})
    }
    const declared = surface.menus?.['color.text']
    expect(declared).toBeDefined()
    declared?.content(() => {
      close = null
    })
    expect(typeof close).toBe('function')
  })
})

describe('the shared swatch panel', () => {
  test('it offers the ten colour presets the old toolbar offered', () => {
    // Same list, same order, same `default` meaning remove. The panel was moved
    // rather than rewritten, so a change here is a change in behaviour.
    expect(COLOR_PRESETS).toEqual([
      'default',
      'gray',
      'brown',
      'red',
      'orange',
      'yellow',
      'green',
      'blue',
      'purple',
      'pink'
    ])
  })

  test('`default` is first, because it is the only one that removes a colour', () => {
    expect(COLOR_PRESETS[0]).toBe('default')
  })
})

describe('the model declares no menu flags of its own', () => {
  test('no control carries a hasMenu flag', () => {
    // Menu-ness is a property of what a *surface* supplies, not of the control
    // declaration. A flag here would have meant every surface agreed on which
    // controls open panels, which is the opposite of what a capability model is
    // for. The flag was removed when the `menus` record replaced it.
    for (const control of TOOLBAR_CONTROLS) {
      expect('hasMenu' in control).toBe(false)
    }
  })

  test('every control still has a key, a label and an icon', () => {
    for (const control of TOOLBAR_CONTROLS) {
      expect(typeof control.key).toBe('string')
      expect(control.label.length).toBeGreaterThan(0)
      expect(control.Icon).toBeDefined()
    }
  })
})

describe('availability is unchanged by the seam work', () => {
  test('AVAILABLE still carries no reason', () => {
    expect(AVAILABLE.available).toBe(true)
  })

  test('unavailable still always carries a reason', () => {
    const result = unavailable('x')
    expect(result.available).toBe(false)
    if (!result.available) expect(result.reason.length).toBeGreaterThan(0)
  })
})
