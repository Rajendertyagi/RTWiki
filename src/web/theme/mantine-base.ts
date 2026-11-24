import type { MantineThemeOverride } from '@mantine/core'

/**
 * Fixed Mantine theme values that are NOT theme data.
 *
 * These used to live in each theme JSON file. They are app-wide constants —
 * radius, spacing, typography, shadows and focus-ring behaviour — and must not
 * change when a user switches colour themes. Keeping them here means a theme
 * file can be colour-only, and switching themes cannot alter shape or size.
 *
 * Values are transcribed verbatim from the previous default theme so the
 * rendered result is pixel-identical.
 */
export const FIXED_MANTINE_BASE: MantineThemeOverride = {
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  // Consumed as --mantine-font-family-monospace by editor-theme.ts and
  // markdown-columns.css. Verbatim Mantine default so rendering is unchanged.
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace',
  defaultRadius: 'md',
  radius: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px' },
  shadows: {
    xs: '0 1px 2px rgba(0,0,0,0.05)',
    sm: '0 2px 8px rgba(0,0,0,0.08)',
    md: '0 4px 16px rgba(0,0,0,0.12)'
  },
  focusRing: 'auto',
  // Owner decision 4 (P4 accessibility): honour the OS reduced-motion setting.
  // Validated before enabling: Mantine's use-transition, Collapse and
  // FloatingIndicator zero their transition durations when this is true and the
  // OS prefers reduced motion; there is no prefers-reduced-motion CSS in src/web
  // to conflict with it, and the P4 browser test only checks the app renders.
  respectReducedMotion: true,
  spacing: {
    // Fine steps for icon/optical spacing, extending Mantine's own scale via its
    // documented custom-key support (assignSizeVariables emits --mantine-spacing-*).
    xxs: '4px',
    xxs2: '6px',
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
}
