/**
 * Copies authored theme JSON files into the web build output so the server can
 * read the same themes the browser bundle contains. `src/web/themes/` remains
 * the single authored source; this is a derived copy, guarded by a parity test.
 */
import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const source = join(import.meta.dir, '..', 'src', 'web', 'themes')
const destination = join(import.meta.dir, '..', 'build', 'web', 'themes')

const files = readdirSync(source).filter((name) => name.endsWith('.json'))
mkdirSync(destination, { recursive: true })
for (const file of files) {
  cpSync(join(source, file), join(destination, file))
}
console.log(`Copied ${files.length} theme(s) to ${destination}`)
