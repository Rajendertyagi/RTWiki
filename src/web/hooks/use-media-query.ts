import { useEffect, useState } from 'react'

/**
 * Reactive `(max-width: Npx)` binding with an SSR-safe initial value.
 * Used by Slice 2 for the temporary narrow-window sidebar collapse; the
 * threshold itself is derived from named LAYOUT minimums at the call site.
 */
export function useMediaQueryBelow(maxWidthPx: number): boolean {
  const [below, setBelow] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(`(max-width: ${maxWidthPx}px)`).matches
      : false
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(`(max-width: ${maxWidthPx}px)`)
    const onChange = (event: MediaQueryListEvent): void => setBelow(event.matches)
    setBelow(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [maxWidthPx])

  return below
}
