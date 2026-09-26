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
      input: resolve(repoRoot, 'src/web/index.html')
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
