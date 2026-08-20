import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

// Vite bundles this config into node_modules/.vite-temp at load time, so
// import.meta.url does not point at the repository root. Walk up from the
// config's location to the directory that owns package.json (the repo root).
// This mirrors the app's own findProjectRoot() so web root and build output
// resolve deterministically regardless of where Vite stages the temp bundle.
function findRepoRoot(start: string): string {
  let dir = start
  while (true) {
    if (existsSync(resolve(dir, "package.json"))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return start
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)))

export default defineConfig({
  plugins: [react()],
  root: resolve(repoRoot, "src/web"),
  build: {
    outDir: resolve(repoRoot, "build/web"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(repoRoot, "src/web/index.html"),
    },
  },
  resolve: {
    alias: {
      "@rtwiki/shared": resolve(repoRoot, "src/shared"),
      "@rtwiki/web": resolve(repoRoot, "src/web"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
})
