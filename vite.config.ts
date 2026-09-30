import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Vite bundles this config into node_modules/.vite-temp at load time, so
// import.meta.url does not point at the repository root. Walk up from the
// config's location to the directory that owns package.json (the repo root).
// This mirrors the app's own findProjectRoot() so web root and build output
// resolve deterministically regardless of where Vite stages the temp bundle.
function findRepoRoot(start: string): string {
  let dir = start
  while (true) {
    if (existsSync(resolve(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return start
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)))

export default defineConfig({
  plugins: [react()],
  root: resolve(repoRoot, 'src/web'),
  // Stated explicitly because the web root is src/web, which would otherwise
  // make Vite look for src/web/public. Static assets that ship with the app
  // live at the repository root: currently the vendored Hunspell dictionary
  // that spell check fetches, so it is served by RTWiki itself and nothing is
  // ever requested from the internet.
  publicDir: resolve(repoRoot, 'public'),
  build: {
    outDir: resolve(repoRoot, 'build/web'),
    emptyOutDir: true,
    // Mermaid 12 is built to ES2024 and declares Safari 17.4+ as its floor, so
    // the target is stated rather than inherited from Vite's default. Stating it
    // keeps our own output aligned with the dependency we cannot transpile:
    // node_modules is not downlevelled, so a lower target here would only widen
    // the gap between our code and the library it ships with.
    target: 'es2024',
    rollupOptions: {
      input: resolve(repoRoot, 'src/web/index.html'),
      // Suppresses exactly one diagnostic, from exactly one third-party file.
      //
      // `IMPORT_IS_UNDEFINED`: "Import `default` will always be undefined because there
      // is no matching export". It points at @mantine/schedule's
      // expand-recurring-events, which contains:
      //
      //   import * as rruleAll from 'rrule'
      //   const RRule = "default" in rruleAll ? rruleAll.default.RRule : rruleAll.RRule
      //
      // That is defensive code in Mantine's own source, for an rrule export shape that
      // cannot occur. `@mantine/schedule@9.6.2` requires `rrule@^2.8.1`, and no rrule
      // 2.x release exports `default` from its ESM entry (checked 2.6.2 -> 2.8.1: the
      // only `export default` in the package are the internal CallbackIterResult and
      // IterResult classes). The named `RRule` export is what always exists, so the
      // ternary always takes its second branch and the app works.
      //
      // Not fixable from here, and deliberately not worked around:
      //   - upgrading @mantine/schedule does not help: 9.6.3 is the latest and carries
      //     the identical line;
      //   - changing the rrule version would violate Mantine's own declared range, and
      //     every in-range version has the same export shape;
      //   - patching node_modules is not permitted and would not survive install.
      // The remaining honest option was a local shim re-exporting a synthetic
      // `default`, which satisfies the static check while adding a vendored module
      // that can silently drift from the real package. A targeted, documented filter is
      // the smaller and more truthful cost.
      //
      // Scoped to IMPORT_IS_UNDEFINED *and* to @mantine/schedule, so a genuine missing
      // export anywhere else - including in RTWiki's own code - still fails the build.
      onwarn(warning: { code?: string; id?: string }, defaultHandler: (w: unknown) => void): void {
        if (
          warning.code === 'IMPORT_IS_UNDEFINED' &&
          (warning.id ?? '').includes('@mantine/schedule')
        )
          return
        defaultHandler(warning)
      }
    }
  },
  resolve: {
    alias: {
      '@rtwiki/shared': resolve(repoRoot, 'src/shared'),
      '@rtwiki/web': resolve(repoRoot, 'src/web')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true
      }
    }
  }
})
