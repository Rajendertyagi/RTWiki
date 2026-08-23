/**
 * Informational bundle-size measurement for the built web application.
 *
 * Measures every production JavaScript asset emitted by Vite under
 * `build/web/assets/`, reporting raw and gzip sizes per file plus totals.
 *
 * - Informational only: there is deliberately no size threshold.
 * - Exits non-zero only when the expected build output cannot be found,
 *   i.e. when measurement is impossible.
 *
 * Run on GitHub-hosted runners after `bun run build:web`:
 *   bun scripts/measure-bundle.ts
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// import.meta.dir is <repo>/scripts; one level up is the repository root.
const repoRoot = join(import.meta.dir, '..')
const assetsDir = join(repoRoot, 'build', 'web', 'assets')

if (!existsSync(assetsDir)) {
  console.error(`Bundle measurement failed: assets directory not found: ${assetsDir}`)
  process.exit(1)
}

const jsFiles = readdirSync(assetsDir)
  .filter((name) => name.endsWith('.js') && statSync(join(assetsDir, name)).isFile())
  .sort()

if (jsFiles.length === 0) {
  console.error('Bundle measurement failed: no .js assets found in build/web/assets')
  process.exit(1)
}

let totalRaw = 0
let totalGzip = 0
const rows: string[] = []

for (const name of jsFiles) {
  const raw = readFileSync(join(assetsDir, name))
  const gz = Bun.gzipSync(raw)
  const rawBytes = raw.byteLength
  const gzipBytes = gz.byteLength
  totalRaw += rawBytes
  totalGzip += gzipBytes
  rows.push(`| ${name} | ${rawBytes} | ${gzipBytes} |`)
  console.log(`JS ${name}: raw=${rawBytes} gzip=${gzipBytes}`)
}

console.log(`JS TOTAL: raw=${totalRaw} gzip=${totalGzip}`)

// Surface the totals as a check-run annotation: job logs require
// authentication, annotations are readable without it.
if (process.env.GITHUB_ACTIONS === 'true') {
  console.log(`::notice title=Bundle totals::raw=${totalRaw} gzip=${totalGzip} bytes`)
}

// Append a markdown summary when running inside GitHub Actions.
const summaryPath = process.env.GITHUB_STEP_SUMMARY
if (summaryPath) {
  const table = [
    '### Web bundle measurement (informational)',
    '',
    '| Asset | Raw bytes | Gzip bytes |',
    '|---|---:|---:|',
    ...rows,
    `| **Total** | **${totalRaw}** | **${totalGzip}** |`,
    ''
  ].join('\n')
  appendFileSync(summaryPath, table)
}
