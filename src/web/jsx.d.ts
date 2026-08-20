/// <reference types="vite/client" />

// React 19 + TypeScript 7 compatibility layer.
// React 19 moved JSX types out of the global namespace.
// This module Augments the global JSX namespace using React 19's exported types.
import type * as React from 'react'

// Create a local alias to avoid redeclaration issues
type _ReactJSX = typeof React extends { default: { JSX: infer T } } ? T : never

// Declare the global JSX namespace
declare global {
  // eslint-disable-next-line no-var
  var _jsxNamespace: _ReactJSX
}

export {}
