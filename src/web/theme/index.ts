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
  // Surface scale invariants, per scheme:
  //  - `--rtwiki-background` is the DOCUMENT canvas. It must equal the tone the
  //    rich editor paints on its own content, otherwise the scroll owner frames
  //    that content as a separate card.
  //  - `--rtwiki-surface` is a PANEL (rail, tree, right pane, settings): always
  //    a distinct step from the document, never the same tone.
  //  - each scheme stays monotonic: rail < document < panel < raised (dark) and
  //    panel < document (light, where the canvas is the brightest).
  light: {
    '--rtwiki-rail-bg': '#e8e8e8',
    // Document canvas. BlockNote paints white content in the light scheme.
    '--rtwiki-background': '#ffffff',
    '--rtwiki-surface': '#f2f2f2',
    '--rtwiki-surface-raised': '#ffffff',
    '--rtwiki-border': '#dbdbdb',
    '--rtwiki-text': '#383838',
    '--rtwiki-text-muted': '#666666'
  },
  dark: {
    '--rtwiki-rail-bg': '#1a1a1a',
    // Document canvas. BlockNote paints #1f1f1f content in the dark scheme, so
    // the canvas matches it and the editor reads as one continuous page.
    '--rtwiki-background': '#1f1f1f',
    // One step lighter than the document, so panels stay distinguishable.
    '--rtwiki-surface': '#242424',
    '--rtwiki-surface-raised': '#262626',
    '--rtwiki-border': '#454545',
    '--rtwiki-text': '#cccccc',
    '--rtwiki-text-muted': '#bbbbbb'
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
