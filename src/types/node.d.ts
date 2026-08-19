// Minimal Node.js builtin type shims so `tsc --noEmit` can typecheck the
// server without pulling in @types/node (which would require updating bun.lock).
// At runtime Bun/Node provide the real implementations; these declarations only
// satisfy the TypeScript compiler for the small subset of the Node API used.
//
// `node:*` builtins are shimmed with a wildcard module whose exports are `any`,
// which also lets third-party type declarations (e.g. hono/node-server) that
// import node: modules resolve during typecheck.

declare module 'node:*' {
  const nodeModule: any
  export = nodeModule
}

declare const process: {
  execPath: string
  cwd(): string
  exit(code?: number): never
  argv: string[]
  env: Record<string, string | undefined>
  platform: string
  version: string
  on(event: string, listener: (...args: any[]) => void): void
  off(event: string, listener: (...args: any[]) => void): void
  stdout: { write(data: string): boolean }
  stderr: { write(data: string): boolean }
}
