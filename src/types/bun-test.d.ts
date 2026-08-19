// Ambient module declaration for Bun's test-runner API (bun:test).
// The project intentionally avoids pulling @types/bun into bun.lock, so we
// declare the module used by tests/foundation.test.ts to satisfy `tsc --noEmit`.
declare module 'bun:test'
