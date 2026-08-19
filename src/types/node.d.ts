// Minimal Node.js builtin type shims so `tsc --noEmit` can typecheck the
// server without pulling in @types/node (which would require updating bun.lock).
// At runtime Bun/Node provide the real implementations; these declarations only
// satisfy the TypeScript compiler for the small subset of the Node API used.

declare module 'node:fs' {
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
  export function existsSync(path: string): boolean
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
}

declare module 'node:path' {
  export function join(...parts: string[]): string
  export function dirname(path: string): string
}

declare module 'node:os' {
  export function tmpdir(): string
}

declare const process: {
  execPath: string
  argv: string[]
  env: Record<string, string | undefined>
  platform: string
  version: string
  cwd(): string
  exit(code?: number): never
  // biome-ignore lint/suspicious/noExplicitAny: minimal Node shim; listener arg types unavailable without @types/node
  on(event: string, listener: (...args: any[]) => void): void
  // biome-ignore lint/suspicious/noExplicitAny: minimal Node shim; listener arg types unavailable without @types/node
  off(event: string, listener: (...args: any[]) => void): void
  stdout: { write(data: string): boolean }
  stderr: { write(data: string): boolean }
}
