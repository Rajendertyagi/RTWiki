/**
 * Build script for the RTWiki server executable.
 *
 * Uses the Bun.build() JavaScript API so we can conditionally set Windows
 * PE metadata (title, description, version, publisher) when compiling
 * natively on Windows. On Linux the metadata flags are skipped because they
 * require native Windows APIs and are not available during cross-compilation.
 */

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
