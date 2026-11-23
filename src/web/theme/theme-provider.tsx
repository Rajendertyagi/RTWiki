import { type MantineColorSchemeManager, MantineProvider } from '@mantine/core'
import { type ReactNode, useEffect, useState } from 'react'

import { createThemeCssVariablesResolver } from './index.js'
import { type AppTheme, getTheme } from './registry.js'

const THEME_CHANGE_EVENT = 'rtwiki:theme-change'

/** Requests a live theme change. Persistence is handled by the caller. */
export function requestThemeChange(themeId: string): void {
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: themeId }))
}

interface ThemeProviderProps {
  colorSchemeManager: MantineColorSchemeManager
  children: ReactNode
}

/**
 * Owns the active theme at the root so changing it updates MantineProvider's
 * `theme` prop without remounting the provider or the app beneath it. Editor
 * text, tabs and tree state therefore survive a theme switch.
 */
export function ThemeProvider({ colorSchemeManager, children }: ThemeProviderProps): JSX.Element {
  const [theme, setTheme] = useState<AppTheme>(() => {
    const id = document.documentElement.getAttribute('data-rtwiki-theme') ?? 'default'
    return getTheme(id)
  })

  useEffect(() => {
    const onThemeChange = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      setTheme(getTheme(id))
      document.documentElement.setAttribute('data-rtwiki-theme', id)
    }
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange)
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange)
  }, [])

  return (
    <MantineProvider
      theme={theme.mantine}
      cssVariablesResolver={createThemeCssVariablesResolver(theme)}
      defaultColorScheme="auto"
      colorSchemeManager={colorSchemeManager}
    >
      {children}
    </MantineProvider>
  )
}
