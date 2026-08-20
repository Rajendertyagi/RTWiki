/// <reference types="vite/client" />

import React from 'react'

// React 19 + TypeScript 7 requires explicit JSX namespace import.
// This global declaration makes JSX.Element available without importing it in every file.
declare global {
  // eslint-disable-next-line no-var
  var React: typeof React
}

export {}
