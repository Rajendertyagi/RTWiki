import { type MantineColorSchemeManager, MantineProvider } from '@mantine/core'
import { type ReactNode, useEffect, useState } from 'react'

import { createThemeCssVariablesResolver } from './index.js'
import { type AppTheme, getTheme } from './registry.js'

const THEME_CHANGE_EVENT = 'rtwiki:theme-change'
const ADJUST_EVENT = 'rtwiki:adjustments-change'

/** Requests a live theme change. Persistence is handled by the caller. */
export function requestThemeChange(themeId: string): void {
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: themeId }))
}

/** Requests a live interface adjustment change. */
export function requestAdjustments(contrast: number, glassOpacity: number): void {
  window.dispatchEvent(new CustomEvent(ADJUST_EVENT, { detail: { contrast, glassOpacity } }))
}

function readAdjustments(): { contrast: number; glassOpacity: number } {
  const root = document.documentElement
  const contrast = Number(root.getAttribute('data-rtwiki-contrast') ?? '100')
  const glass = Number(root.getAttribute('data-rtwiki-glass-opacity') ?? '100')
  return {
    contrast: Number.isFinite(contrast) ? contrast : 100,
    glassOpacity: Number.isFinite(glass) ? glass : 100
  }
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
  const [adjustments, setAdjustments] = useState(readAdjustments)

  useEffect(() => {
    const onThemeChange = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      setTheme(getTheme(id))
      document.documentElement.setAttribute('data-rtwiki-theme', id)
    }
    const onAdjust = (event: Event): void => {
      const detail = (event as CustomEvent<{ contrast: number; glassOpacity: number }>).detail
      setAdjustments(detail)
      document.documentElement.setAttribute('data-rtwiki-contrast', String(detail.contrast))
      document.documentElement.setAttribute(
        'data-rtwiki-glass-opacity',
        String(detail.glassOpacity)
      )
    }
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange)
    window.addEventListener(ADJUST_EVENT, onAdjust)
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange)
      window.removeEventListener(ADJUST_EVENT, onAdjust)
    }
  }, [])

  return (
    <MantineProvider
      theme={theme.mantine}
      cssVariablesResolver={createThemeCssVariablesResolver(theme, adjustments)}
      defaultColorScheme="auto"
      colorSchemeManager={colorSchemeManager}
      // Mantine strips resolver overrides whose value equals DEFAULT_THEME's.
      // Our surface overrides must survive even when they match a default.
      deduplicateCssVariables={false}
    >
      {children}
    </MantineProvider>
  )
}
