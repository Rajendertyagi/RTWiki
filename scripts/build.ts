/**
 * Build script for the RTWiki server executable.
 *
 * Uses the Bun.build() JavaScript API so we can conditionally set Windows
 * PE metadata (title, description, version, publisher) when compiling
 * natively on Windows. On Linux the metadata flags are skipped because they
 * require native Windows APIs and are not available during cross-compilation.
 *
 * Also stages the built frontend beside the executable. A compiled RTWiki
 * resolves its assets relative to its own directory (see
 * resolveRuntimePaths in src/server/config), so `build/server/RTWiki.exe`
 * needs `build/server/web` to exist. Without this step the executable builds
 * cleanly, ships with no UI, and serves a bare Not Found for every page -
 * a failure that looks like a product bug rather than a packaging one.
 */

import { cpSync, existsSync, rmSync } from 'node:fs'

const SERVER_DIR = 'build/server'
const WEB_SOURCE = 'build/web'
const WEB_DESTINATION = `${SERVER_DIR}/web`

const isWindows = process.platform === 'win32'

const compileOptions: Parameters<typeof Bun.build>[0]['compile'] = {
  target: 'bun-windows-x64',
  outfile: 'build/server/RTWiki.exe',
  ...(isWindows
    ? {
        windows: {
          title: 'RTWiki',
          description: 'A personal knowledge workspace for your family',
          version: '0.1.0',
          publisher: 'RTWiki'
        }
      }
    : {})
}

const result = await Bun.build({
  entrypoints: ['src/server/index.ts'],
  compile: compileOptions
})

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log('Build succeeded:', result.outputs[0].path)

// Stage the frontend beside the executable so the compiled app can serve it.
// Replaced rather than merged, so a stale asset from a previous build can never
// survive into a new one.
if (existsSync(WEB_SOURCE)) {
  rmSync(WEB_DESTINATION, { recursive: true, force: true })
  cpSync(WEB_SOURCE, WEB_DESTINATION, { recursive: true })
  console.log(`Frontend staged: ${WEB_DESTINATION}`)
} else {
  // Not fatal: `bun run build:server` on its own is a legitimate way to rebuild
  // just the executable while iterating. But say so loudly, because the result
  // is an application that starts and then serves nothing.
  console.warn(
    `\nWARNING: ${WEB_SOURCE} does not exist, so the executable will ship with no UI.\n` +
      `         Run \`bun run build:web\` first (or just \`bun run build\`).\n`
  )
}
