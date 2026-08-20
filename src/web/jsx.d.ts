/// <reference types="vite/client" />

// React 19 + TypeScript 7 requires explicit JSX namespace import.
// This global declaration makes JSX.Element available without importing it in every file.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface Element extends React.JSX.Element {}
    interface ElementClass extends React.JSX.ElementClass {}
    interface IntrinsicElements extends React.JSX.IntrinsicElements {}
  }
}
