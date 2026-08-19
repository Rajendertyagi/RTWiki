// Minimal ambient type declarations for Bun's built-in `bun:sqlite` module.
//
// The project intentionally avoids pulling @types/bun into bun.lock (see the note
// in src/types/node.d.ts), so we declare only the subset of the `Database` API the
// server actually uses. Shapes follow the official Bun docs:
//   - db.run(sql, params?)  executes SQL (CREATE/INSERT/PRAGMA); `exec` is an alias
//   - db.query(sql)         returns a Statement with .get()/.all()/.run()
//   - db.prepare(sql)       returns a Statement
//   - db.close()            closes the connection
declare module 'bun:sqlite' {
  export class Database {
    constructor(path: string, options?: unknown)
    exec(source: string): void
    run(source: string, ...params: unknown[]): { lastInsertRowid: number; changes: number }
    query<T = unknown>(
      source: string
    ): {
      get(...params: unknown[]): T | null
      all(...params: unknown[]): T[]
      run(...params: unknown[]): unknown
    }
    prepare<T = unknown>(
      source: string
    ): {
      get(...params: unknown[]): T | null
      all(...params: unknown[]): T[]
      run(...params: unknown[]): unknown
    }
    close(): void
  }
}
