import type { CSSVariablesResolver } from '@mantine/core'
import { LAYOUT, MOTION, Z_INDEX } from '../config/index.js'
import { type AppTheme, buildVariantVariables, DEFAULT_THEME_ID, getTheme } from './registry.js'

export type {
  AppTheme,
  RequiredInteractionToken,
  RequiredVariantToken,
  ThemeVariant,
  ThemeVariants
} from './registry.js'
export {
  APP_THEMES,
  buildVariantVariables,
  DEFAULT_THEME_ID,
  getTheme,
  REQUIRED_INTERACTION_TOKENS,
  REQUIRED_VARIANT_TOKENS,
  VARIANT_TOKEN_NAMES
} from './registry.js'

/**
 * Persisted theme identifier. The light/dark variant is owned by Mantine, which
 * already persists it; only the theme identity is RTWiki's to store. The picker
 * that writes this key is not part of the first slice, so an unset or unknown
 * value resolves to the default theme.
 */
const THEME_STORAGE_KEY = 'rtwiki-theme-id'

interface ThemeStorage {
  getItem(key: string): string | null
}

export function resolveActiveTheme(storage?: ThemeStorage | null): AppTheme {
  let stored: string | null = null
  try {
    const source = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
    stored = source?.getItem(THEME_STORAGE_KEY) ?? null
  } catch {
    // Storage can be unavailable (privacy mode, blocked cookies). The default
    // theme is always a safe answer, so a read failure is not fatal.
    stored = null
  }
  if (stored === null) {
    return getTheme(DEFAULT_THEME_ID)
  }
  return getTheme(stored)
}

/**
 * Builds the Mantine CSS variables resolver for one theme. Mantine applies the
 * returned `light` or `dark` map based on `data-mantine-color-scheme`, so the
 * binary scheme selects a variant *within* whichever theme is active.
 */
export function createThemeCssVariablesResolver(theme: AppTheme): CSSVariablesResolver {
  return () => ({
    variables: {
      // Shared overlay stacking level for every floating layer (menus,
      // popovers, portals, full-screen workspaces). Defined once here so
      // stylesheet consumers and inline styles never diverge.
      '--rtwiki-overlay-z-index': String(LAYOUT.overlayZIndex),
      // Layout dimensions, published as custom properties so CSS can own the
      // layout instead of components passing style objects. LAYOUT stays the
      // single source: this is the same numbers, made readable from a
      // stylesheet, not a second definition of them.
      '--rtwiki-rail-width': `${LAYOUT.railWidth}px`,
      '--rtwiki-divider-hit-width': `${LAYOUT.dividerHitWidth}px`,
      '--rtwiki-divider-step-width': `${LAYOUT.dividerStepWidth}px`,
      '--rtwiki-mobile-drawer-width': `${LAYOUT.mobileDrawerWidth}px`,
      '--rtwiki-status-bar-height': `${LAYOUT.statusBarHeight}px`,
      // Scrollbar thickness for the native, restyled scrollbars. Published from
      // LAYOUT for the same reason the layout dimensions above are: this is the
      // same number the `ScrollArea` components are given, not a second
      // definition of it. Without this the two mechanisms could drift apart and
      // the app would carry a thin bar beside a thick one.
      '--rtwiki-scrollbar-size': `${LAYOUT.scrollbar.size}px`,
      // The dropdown height cap, published for the same reason: stylesheets read
      // it as a custom property and `ScrollArea` call sites pass it as `mah`, and
      // both must be the same number.
      '--rtwiki-panel-max-height': `${LAYOUT.panelMaxHeight}px`,
      '--rtwiki-workspace-min-width': `${LAYOUT.workspaceMinWidth}px`,
      // The shortest a Rich Note diagram block may render, which is the height of the
      // controls it carries. Published rather than written into a stylesheet because the
      // same number also clamps the drag and the keyboard in `block-resize.tsx`; a block
      // with **no stored height** can only be floored here, since nothing in the
      // commit path ever sees a number to clamp.
      '--rtwiki-block-controls-min-height': `${LAYOUT.blockControlsMinHeight}px`,
      // The Diagram page's floor: the same controls plus the card's action row and
      // border. A separate token because the Diagram page card really does need more
      // room, and one shared floor under-floored it — measured 6px of the control pad
      // and 28px of canvas clipped off a 140px block. See LAYOUT.
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
      // Motion durations.
      '--rtwiki-motion-fast': `${MOTION.fast}ms`,
      '--rtwiki-motion-tab': `${MOTION.tab}ms`,
      // Tab strip z-index scale.
      '--rtwiki-z-tab-handle': String(Z_INDEX.tabHandle),
      '--rtwiki-z-tab-close': String(Z_INDEX.tabClose),
      '--rtwiki-z-tab-active': String(Z_INDEX.tabActive),
      '--rtwiki-z-tab-drag': String(Z_INDEX.tabDrag)
    },
    light: buildVariantVariables(theme.variants.light),
    dark: buildVariantVariables(theme.variants.dark)
  })
}
