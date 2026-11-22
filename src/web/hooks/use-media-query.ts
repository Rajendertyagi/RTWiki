import { useMediaQuery } from '@mantine/hooks'

/**
 * Reactive `(max-width: Npx)` binding with an SSR-safe initial value.
 * Used by Slice 2 for the temporary narrow-window sidebar collapse; the
 * threshold itself is derived from named LAYOUT minimums at the call site.
 *
 * `getInitialValueInEffect: false` is required: Mantine's default computes the
 * value in an effect, which would make the first render report `false` and
 * cause a visible expand-then-collapse flicker on a narrow window. With this
 * option the hook reads `matchMedia` synchronously on the client, matching the
 * previous hand-rolled behaviour exactly.
 */
export function useMediaQueryBelow(maxWidthPx: number): boolean {
  return useMediaQuery(`(max-width: ${maxWidthPx}px)`, undefined, {
    getInitialValueInEffect: false
  })
}
