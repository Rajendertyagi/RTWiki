/**
 * Bun-only theme file reader. Imported dynamically by registry.ts only when
 * import.meta.glob is unavailable (i.e. under the Bun test runner). Vite never
 * includes this module in the browser bundle because the glob branch is chosen
 * statically at build time.
 */
// biome-ignore lint/correctness/noNodejsModules: Bun-only test reader; Vite never bundles this module.
import { readdirSync, readFileSync } from 'node:fs'
// biome-ignore lint/correctness/noNodejsModules: Bun-only test reader; Vite never bundles this module.
import { join } from 'node:path'

export function readThemeFilesFromDisk(): Record<string, unknown> {
  const dir = join(import.meta.dir, '..', 'themes')
  const files: Record<string, unknown> = {}
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    files[`../themes/${name}`] = JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown
  }
  return files
}
