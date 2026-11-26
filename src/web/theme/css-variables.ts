import { LAYOUT, MOTION, Z_INDEX } from '../config/index.js'
import { type Adjustments, applyContrast, applyGlass } from './adjustments.js'
import { buildVariantVariables, type ThemeVariants } from './tokens.js'

/**
 * Server-safe CSS variable construction.
 *
 * This module deliberately imports only config and token definitions — never
 * the registry (which uses Vite's import.meta.glob) or Mantine runtime code.
 * Both the web app's cssVariablesResolver and the server's pre-paint bootstrap
 * call this same function, so the first screen and the final screen cannot
 * disagree about a value.
 */
export interface ThemeCssVariables {
  variables: Record<string, string>
  light: Record<string, string>
  dark: Record<string, string>
}

/**
 * The narrow theme shape both callers can supply. The web `AppTheme` and the
 * server's `ParsedTheme` both satisfy it. `id` and `mantine` are optional so a
 * caller holding only variants still works, but both real callers pass them.
 */
export interface ThemeCssVariablesInput {
  id?: string
  variants: ThemeVariants
  mantine?: {
    primaryColor?: string
    primaryShade?: number | { light?: number; dark?: number }
  }
}

/** A surface mapping we deliberately did not apply, reported to the caller. */
export interface CssVariableFallback {
  themeId: string
  scheme: 'light' | 'dark'
  variable: string
  mappedValue: string
  reason: string
}

export type CssVariableFallbackHandler = (fallback: CssVariableFallback) => void

/** Mantine surface variables that safely follow an RTWiki region token. */
const SAFE_SURFACE_MAPPINGS = {
  '--mantine-color-text': 'text',
  '--mantine-color-body': 'canvas',
  '--mantine-color-default-border': 'border',
  '--mantine-color-dimmed': 'textMuted',
  '--mantine-color-placeholder': 'textMuted',
  '--mantine-color-default-hover': 'hover',
  '--mantine-color-default-color': 'text',
  '--mantine-color-bright': 'text',
  '--mantine-color-disabled-color': 'textMuted'
} as const

/**
 * Mantine surface variables we do NOT override. Each would map to `pane` or
 * `border`, which can flatten default buttons and disabled controls. Owner
 * decision 3: keep Mantine's original value until visual validation exists.
 */
const RISKY_SURFACE_MAPPINGS = {
  '--mantine-color-default': 'pane',
  '--mantine-color-disabled': 'pane',
  '--mantine-color-disabled-border': 'border'
} as const

const RISKY_FALLBACK_REASON =
  'Kept Mantine default: overriding this surface can flatten default or disabled controls; visual validation pending (owner decision 3)'

/** Mantine's own anchor convention, used when a theme supplies no mantine data. */
const DEFAULT_PRIMARY_COLOR = 'blue'
const DEFAULT_PRIMARY_SHADE = { light: 6, dark: 8 } as const

/** The primary palette shade for a scheme, as a Mantine CSS variable reference. */
function resolveAnchor(
  mantine: ThemeCssVariablesInput['mantine'],
  scheme: 'light' | 'dark'
): string {
  const primaryColor = mantine?.primaryColor ?? DEFAULT_PRIMARY_COLOR
  const shade =
    typeof mantine?.primaryShade === 'number'
      ? mantine.primaryShade
      : (mantine?.primaryShade?.[scheme] ?? DEFAULT_PRIMARY_SHADE[scheme])
  return `var(--mantine-color-${primaryColor}-${shade})`
}

function applySurfaceOverrides(
  target: Record<string, string>,
  variant: ThemeVariants['light'],
  scheme: 'light' | 'dark',
  themeId: string,
  mantine: ThemeCssVariablesInput['mantine'],
  onFallback?: CssVariableFallbackHandler
): void {
  for (const [variable, token] of Object.entries(SAFE_SURFACE_MAPPINGS)) {
    target[variable] = variant[token]
  }
  target['--mantine-color-anchor'] = resolveAnchor(mantine, scheme)
  for (const [variable, token] of Object.entries(RISKY_SURFACE_MAPPINGS)) {
    onFallback?.({
      themeId,
      scheme,
      variable,
      mappedValue: variant[token],
      reason: RISKY_FALLBACK_REASON
    })
  }
}

/** Formats a fallback for a structured log line shared by both callers. */
export function formatFallbackMessage(fallback: CssVariableFallback): string {
  return (
    `[RTWiki] theme=${fallback.themeId} scheme=${fallback.scheme} ` +
    `variable=${fallback.variable} mappedValue=${fallback.mappedValue} ` +
    `reason=${fallback.reason}`
  )
}

/** Accepts the narrow shape so server code need not construct a full AppTheme. */
export function buildThemeCssVariables(
  theme: ThemeCssVariablesInput,
  adjustments?: Adjustments,
  onFallback?: CssVariableFallbackHandler
): ThemeCssVariables {
  const light = adjustments
    ? applyContrast(theme.variants.light, 'light', adjustments.contrast)
    : theme.variants.light
  const dark = adjustments
    ? applyContrast(theme.variants.dark, 'dark', adjustments.contrast)
    : theme.variants.dark
  const themeId = theme.id ?? 'unknown'

  const lightVariables: Record<string, string> = {
    ...buildVariantVariables(light),
    // Each scheme floats its own elevated surface; glass scales its alpha.
    '--rtwiki-floating-bg': adjustments
      ? applyGlass(light.elevated, adjustments.glassOpacity)
      : light.elevated
  }
  const darkVariables: Record<string, string> = {
    ...buildVariantVariables(dark),
    '--rtwiki-floating-bg': adjustments
      ? applyGlass(dark.elevated, adjustments.glassOpacity)
      : dark.elevated
  }

  applySurfaceOverrides(lightVariables, light, 'light', themeId, theme.mantine, onFallback)
  applySurfaceOverrides(darkVariables, dark, 'dark', themeId, theme.mantine, onFallback)

  return {
    variables: {
      // Shared overlay stacking level for every floating layer.
      '--rtwiki-overlay-z-index': String(LAYOUT.overlayZIndex),
      // Layout dimensions, published as custom properties so CSS can own layout.
      '--rtwiki-rail-width': `${LAYOUT.railWidth}px`,
      '--rtwiki-divider-hit-width': `${LAYOUT.dividerHitWidth}px`,
      '--rtwiki-divider-step-width': `${LAYOUT.dividerStepWidth}px`,
      '--rtwiki-mobile-drawer-width': `${LAYOUT.mobileDrawerWidth}px`,
      '--rtwiki-status-bar-height': `${LAYOUT.statusBarHeight}px`,
      '--rtwiki-scrollbar-size': `${LAYOUT.scrollbar.size}px`,
      '--rtwiki-panel-max-height': `${LAYOUT.panelMaxHeight}px`,
      '--rtwiki-workspace-min-width': `${LAYOUT.workspaceMinWidth}px`,
      '--rtwiki-settings-nav-width': `${LAYOUT.settingsNavWidth}px`,
      '--rtwiki-block-controls-min-height': `${LAYOUT.blockControlsMinHeight}px`,
      '--rtwiki-visual-page-block-min-height': `${LAYOUT.visualPageBlockMinHeight}px`,
      // Focus ring geometry shared by shell chrome controls.
      '--rtwiki-focus-ring-width': `${LAYOUT.focusRingWidth}px`,
      '--rtwiki-focus-ring-offset': `${LAYOUT.focusRingOffset}px`,
      // Utility rail geometry.
      '--rtwiki-rail-padding-inline': `${LAYOUT.railPaddingInline}px`,
      '--rtwiki-status-dot-size': `${LAYOUT.statusDotSize}px`,
      // Tab strip geometry.
      '--rtwiki-tab-gap': `${LAYOUT.tabGap}px`,
      '--rtwiki-tab-drag-spacer-width': `${LAYOUT.tabDragSpacerWidth}px`,
      '--rtwiki-tab-max-width': `${LAYOUT.tabMaxWidth}px`,
      '--rtwiki-tab-min-width': `${LAYOUT.tabMinWidth}px`,
      '--rtwiki-tab-active-inset': `${LAYOUT.tabActiveInset}px`,
      '--rtwiki-tab-pad-inline-start': `${LAYOUT.tabPadInlineStart}px`,
      '--rtwiki-tab-pad-inline-end': `${LAYOUT.tabPadInlineEnd}px`,
      '--rtwiki-tab-separator-inset': `${LAYOUT.tabSeparatorInset}px`,
      '--rtwiki-tab-close-size': `${LAYOUT.tabCloseSize}px`,
      // Status bar compact geometry.
      '--rtwiki-status-bar-pad-inline': LAYOUT.statusBarPadInline,
      '--rtwiki-status-bar-font-size': LAYOUT.statusBarFontSize,
      '--rtwiki-status-bar-actions-pad': LAYOUT.statusBarActionsPad,
      '--rtwiki-status-bar-actions-gap': LAYOUT.statusBarActionsGap,
      '--rtwiki-status-bar-breadcrumb-gap': `${LAYOUT.statusBarBreadcrumbGap}px`,
      '--rtwiki-status-bar-crumb-pad-block': `${LAYOUT.statusBarCrumbPadBlock}px`,
      '--rtwiki-status-bar-crumb-pad-inline': `${LAYOUT.statusBarCrumbPadInline}px`,
      '--rtwiki-status-bar-action-gap': `${LAYOUT.statusBarActionGap}px`,
      '--rtwiki-status-bar-action-height': `${LAYOUT.statusBarActionHeight}px`,
      '--rtwiki-status-bar-action-pad-inline': LAYOUT.statusBarActionPadInline,
      '--rtwiki-status-bar-action-text-font-size': LAYOUT.statusBarActionTextFontSize,
      '--rtwiki-status-bar-backlinks-min-width': `${LAYOUT.statusBarBacklinksMinWidth}px`,
      '--rtwiki-status-bar-backlinks-max-width': `${LAYOUT.statusBarBacklinksMaxWidth}px`,
      '--rtwiki-status-bar-dropdown-header-margin-bottom': `${LAYOUT.statusBarDropdownHeaderMarginBottom}px`,
      '--rtwiki-status-bar-backlink-item-pad-block': `${LAYOUT.statusBarBacklinkItemPadBlock}px`,
      '--rtwiki-status-bar-backlink-item-pad-inline': `${LAYOUT.statusBarBacklinkItemPadInline}px`,
      '--rtwiki-status-bar-info-min-width': `${LAYOUT.statusBarInfoMinWidth}px`,
      // Motion durations. Each token is a separate interaction decision from
      // MOTION; equal numbers do not mean a shared token (different easing/feel).
      '--rtwiki-motion-fast': `${MOTION.fast}ms`,
      '--rtwiki-motion-tab': `${MOTION.tab}ms`,
      '--rtwiki-motion-tree-hover': `${MOTION.treeHover}ms`,
      '--rtwiki-motion-card-hover': `${MOTION.cardHover}ms`,
      // Tab strip z-index scale.
      '--rtwiki-z-tab-handle': String(Z_INDEX.tabHandle),
      '--rtwiki-z-tab-close': String(Z_INDEX.tabClose),
      '--rtwiki-z-tab-active': String(Z_INDEX.tabActive),
      '--rtwiki-z-tab-drag': String(Z_INDEX.tabDrag)
    },
    light: lightVariables,
    dark: darkVariables
  }
}
