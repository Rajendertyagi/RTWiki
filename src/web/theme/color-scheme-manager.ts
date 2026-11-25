import type { MantineColorScheme, MantineColorSchemeManager } from '@mantine/core'

import { updateColorScheme } from '../services/server-settings-api.js'

/**
 * Mantine color-scheme manager backed by the SQLite settings table.
 *
 * The pre-paint script in index.html sets `data-mantine-color-scheme` (the
 * computed light/dark value) and `data-rtwiki-color-scheme-choice` (the user's
 * raw choice, which may be 'auto'). `get()` reads the raw choice synchronously
 * so Mantine mounts with the correct value and never consults localStorage.
 */
const CHOICE_ATTRIBUTE = 'data-rtwiki-color-scheme-choice'

function isColorScheme(value: string | null | undefined): value is MantineColorScheme {
  return value === 'auto' || value === 'light' || value === 'dark'
}

export function createDbColorSchemeManager(): MantineColorSchemeManager {
  const set = (value: MantineColorScheme): void => {
    // Persist to the database. On failure keep the in-memory value; there is
    // deliberately no localStorage fallback.
    void updateColorScheme(value).catch((error: unknown) => {
      console.warn('[RTWiki] Could not save color scheme:', error)
    })
  }

  return {
    get(defaultValue: MantineColorScheme): MantineColorScheme {
      const attribute = document.documentElement.getAttribute(CHOICE_ATTRIBUTE)
      return isColorScheme(attribute) ? attribute : defaultValue
    },

    set,

    subscribe(_onUpdate: (value: MantineColorScheme) => void): void {
      // No-op. Mantine's own setColorScheme updates its provider state directly,
      // and RTWiki has no external color-scheme change source: the settings UI
      // goes through useMantineColorScheme().setColorScheme, and the pre-paint
      // bootstrap value is read via get(). Mantine calls subscribe in an effect,
      // so a no-op is safe. Dispatching an event here used to call Mantine's
      // setColorScheme again, which called set() again - infinite recursion.
    },

    unsubscribe(): void {
      // No-op: there is no subscription to tear down (see subscribe).
    },

    clear(): void {
      set('auto')
    }
  }
}
