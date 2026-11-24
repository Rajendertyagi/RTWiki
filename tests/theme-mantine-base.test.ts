import { describe, expect, it } from 'bun:test'
import { DEFAULT_THEME } from '@mantine/core'

import { FIXED_MANTINE_BASE } from '../src/web/theme/mantine-base.js'

/**
 * Stage 1 guard for the Mantine-owned SSoT. Only two fields were added to the
 * fixed base: one consumed today (fontFamilyMonospace) and one required by
 * owner decision 4 (respectReducedMotion). Everything else stays deferred so
 * no speculative configuration can creep in.
 */
describe('FIXED_MANTINE_BASE — Stage 1 additions', () => {
  it("fontFamilyMonospace is byte-identical to Mantine's current default", () => {
    expect(FIXED_MANTINE_BASE.fontFamilyMonospace).toBe(DEFAULT_THEME.fontFamilyMonospace)
  })

  it('respectReducedMotion is enabled (owner decision 4)', () => {
    expect(FIXED_MANTINE_BASE.respectReducedMotion).toBe(true)
  })

  it('does not add any of the 14 deferred Mantine fields', () => {
    // 14 rows in the plan; "white / black" is one row covering two field names.
    const deferred = [
      'lineHeights',
      'fontWeights',
      'headings',
      'breakpoints',
      'fontSmoothing',
      'white',
      'black',
      'scale',
      'defaultGradient',
      'focusClassName',
      'activeClassName',
      'autoContrast',
      'luminanceThreshold',
      'cursorType',
      'other'
    ] as const
    for (const field of deferred) {
      expect(Object.hasOwn(FIXED_MANTINE_BASE, field), `${field} must stay deferred`).toBe(false)
    }
  })
})
