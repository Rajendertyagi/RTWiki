// Minimal Bun runtime type declarations so `tsc --noEmit` can typecheck the
// server without pulling in @types/bun (which would require updating bun.lock).
// At runtime Bun provides the real implementations; these declarations only
// satisfy the TypeScript compiler for the small subset of the Bun API used.

interface BunFile {
  write(data: string | ArrayBuffer | Uint8Array): Promise<number>
}

declare const Bun: {
  file(path: string): BunFile
  write(path: string, data: string): Promise<number>
  delete(path: string): Promise<void>
}

declare module 'bun:sqlite' {
  export class Database {
    constructor(path: string)
    pragma(source: string): unknown
    query<T = Record<string, unknown>>(
      sql: string,
    ): {
      get: (...params: unknown[]) => T | undefined
      all: (...params: unknown[]) => T[]
      run: (...params: unknown[]) => void
    }
    execute(sql: string, ...params: unknown[]): void
    close(): void
  }
}
