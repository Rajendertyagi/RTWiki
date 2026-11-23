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
const CHANGE_EVENT = 'rtwiki:color-scheme-change'

function isColorScheme(value: string | null | undefined): value is MantineColorScheme {
  return value === 'auto' || value === 'light' || value === 'dark'
}

export function createDbColorSchemeManager(): MantineColorSchemeManager {
  let handler: ((value: MantineColorScheme) => void) | null = null

  const onEvent = (event: Event): void => {
    const value = (event as CustomEvent<MantineColorScheme>).detail
    if (isColorScheme(value)) handler?.(value)
  }

  return {
    get(defaultValue: MantineColorScheme): MantineColorScheme {
      const attribute = document.documentElement.getAttribute(CHOICE_ATTRIBUTE)
      return isColorScheme(attribute) ? attribute : defaultValue
    },

    set(value: MantineColorScheme): void {
      // Persist to the database. On failure keep the in-memory value; there is
      // deliberately no localStorage fallback.
      void updateColorScheme(value).catch((error: unknown) => {
        console.warn('[RTWiki] Could not save color scheme:', error)
      })
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: value }))
    },

    subscribe(onUpdate: (value: MantineColorScheme) => void): void {
      handler = onUpdate
      window.addEventListener(CHANGE_EVENT, onEvent)
    },

    unsubscribe(): void {
      handler = null
      window.removeEventListener(CHANGE_EVENT, onEvent)
    },

    clear(): void {
      this.set('auto')
    }
  }
}
