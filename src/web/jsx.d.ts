/// <reference types="vite/client" />

// React 19 + TypeScript 7 compatibility layer.
// React 19 moved JSX types out of the global namespace.
import type { JSX as _JSX } from 'react'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    type Element = _JSX.Element
    type ElementClass = _JSX.ElementClass
    interface IntrinsicElements extends _JSX.IntrinsicElements {}
  }
}
