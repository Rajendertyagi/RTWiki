import { LAYOUT, MOTION, Z_INDEX } from '../config/index.js'
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

/** Accepts the narrow shape so server code need not construct a full AppTheme. */
export function buildThemeCssVariables(theme: { variants: ThemeVariants }): ThemeCssVariables {
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
  }
}
