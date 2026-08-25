import type { CSSVariablesResolver } from '@mantine/core'
import { createTheme } from '@mantine/core'
import { LAYOUT } from '../config/index.js'

export const rtwikiCssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    // Shared overlay stacking level for every floating layer (menus,
    // popovers, portals, full-screen workspaces). Defined once here so
    // stylesheet consumers and inline styles never diverge.
    '--rtwiki-overlay-z-index': String(LAYOUT.overlayZIndex)
  },
  light: {
    '--rtwiki-background': '#f5f5f5',
    '--rtwiki-surface': '#ffffff',
    '--rtwiki-surface-raised': '#fafafa',
    '--rtwiki-border': '#e0e0e0',
    '--rtwiki-text': '#1a1a1a',
    '--rtwiki-text-muted': '#666666'
  },
  dark: {
    '--rtwiki-background': '#1a1a1a',
    '--rtwiki-surface': '#242424',
    '--rtwiki-surface-raised': '#2a2a2a',
    '--rtwiki-border': '#3a3a3a',
    '--rtwiki-text': '#e8e8e8',
    '--rtwiki-text-muted': '#888888'
  }
})

export const theme = createTheme({
  primaryColor: 'blue',
  colors: {
    blue: [
      '#eaf4ff',
      '#d0e4ff',
      '#a5cbff',
      '#75afff',
      '#4c96ff',
      '#2f80ff',
      '#1c70ff',
      '#0d63fb',
      '#0058eb',
      '#004fd9'
    ]
  },
  primaryShade: { light: 6, dark: 8 },
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  defaultRadius: 'md',
  radius: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px' },
  shadows: {
    xs: '0 1px 2px rgba(0,0,0,0.05)',
    sm: '0 2px 8px rgba(0,0,0,0.08)',
    md: '0 4px 16px rgba(0,0,0,0.12)'
  },
  focusRing: 'auto',
  spacing: {
    xs: '8px',
    sm: '12px',
    md: '16px',
    lg: '20px',
    xl: '24px'
  },
  fontSizes: {
    xs: '0.75rem',
    sm: '0.8125rem',
    md: '0.875rem',
    lg: '1rem',
    xl: '1.125rem'
  }
})
