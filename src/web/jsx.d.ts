/// <reference types="vite/client" />

// React 19 + TypeScript 7 requires explicit JSX namespace import.
// This global declaration makes JSX.Element available without importing it in every file.
import type { JSX } from 'react'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    export { JSX }
  }
}

export {}
