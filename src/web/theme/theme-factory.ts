import { createTheme, Menu, Modal, Popover, ScrollArea, Tooltip } from '@mantine/core'

import { LAYOUT } from '../config/index.js'
import { FLOATING } from './constants.js'
import { parseThemeDefinition } from './theme-definition.js'
import { type AppTheme, REQUIRED_INTERACTION_TOKENS, REQUIRED_VARIANT_TOKENS } from './tokens.js'

/**
 * Pure JSON -> AppTheme conversion. No filesystem or glob access, so it can be
 * used by both the Vite app (which discovers themes with import.meta.glob) and
 * the Bun tests (which read theme files with node:fs).
 *
 * Component defaults stay here rather than in JSON: they wire code constants
 * (FLOATING, LAYOUT.scrollbar.size) and cannot be expressed as data.
 */
export function toAppTheme(json: unknown): AppTheme {
  const parsed = parseThemeDefinition(json, {
    variantTokens: REQUIRED_VARIANT_TOKENS,
    interactionTokens: REQUIRED_INTERACTION_TOKENS
  })
  return {
    id: parsed.id,
    mantine: createTheme({
      ...parsed.mantine,
      components: {
        // Menu, Popover, Dialog, tooltip: the four things that genuinely float.
        Menu: Menu.extend({ classNames: { dropdown: FLOATING } }),
        Popover: Popover.extend({ classNames: { dropdown: FLOATING } }),
        Modal: Modal.extend({ classNames: { content: FLOATING } }),
        Tooltip: Tooltip.extend({ classNames: { tooltip: FLOATING } }),
        /*
         * Scrollbar thickness for every `ScrollArea` in the application.
         * Set as a component default rather than at each call site, so the size
         * has one home. The value is LAYOUT.scrollbar.size, the same number
         * published to CSS as --rtwiki-scrollbar-size for surfaces that cannot
         * use this component. Mantine's own default is 12px, which would be the
         * widest scrollbar in the app and the only one a reader would notice.
         */
        ScrollArea: ScrollArea.extend({
          defaultProps: { scrollbarSize: LAYOUT.scrollbar.size }
        })
      }
    }),
    variants: parsed.variants
  }
}
