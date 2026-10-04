import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Proves syntax highlighting is **lazy at the bundle level** — the claim §16 of the
 * task asks for and the one nothing else in the suite can check.
 *
 * ## Why a test and not a note in the report
 *
 * A grammar being its own chunk is necessary but not sufficient: a *static* import of
 * that chunk somewhere in the entry's graph would pull all twelve grammars on page
 * open, which is exactly the failure this file exists to prevent. Reading a bundle by
 * eye is unreliable — the loaders appear inside Vite's `__vite__mapDeps` table, which
 * *names* chunks without importing them, so a text search for a grammar's filename
 * finds it in both the lazy and the eager case.
 *
 * So this asserts on the **import graph**, not on filenames: it parses each chunk's
 * static imports and fails if any reachable chunk statically imports a grammar.
 */

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const ASSETS = join(ROOT, 'build', 'web', 'assets')

/**
 * Chunk names that identify a grammar or theme chunk.
 *
 * ## Why this cannot be a name pattern, and is a deny-list instead
 *
 * The obvious implementation — "a grammar chunk is named after the grammar" — is
 * **wrong here**, and measurably so. Two attempts failed before this one:
 *
 *   1. A prefix list including `markdown` flags `markdown-workspace-B5DAAugy.js`,
 *      because `markdown` is both a registry grammar and part of two RTWiki feature
 *      chunk names.
 *   2. Excluding `markdown-workspace` by pattern still failed, because the chunk's
 *      hash suffix (`workspace-B5DAAugy`) is itself `[A-Za-z0-9_-]+`, so the tighter
 *      regex still matched.
 *
 * A hash suffix makes **every** name pattern fragile, and the failure mode is a false
 * alarm that reports the workspace's own chunk as a grammar leak. So this is a
 * deny-list: the registry's twelve language/theme names are enumerated exactly, and a
 * chunk is a grammar only if its name matches one of them **exactly** as
 * `<name>-<hash>.js`. `markdown-workspace-B5DAAugy.js` does not match
 * `markdown-…` under that rule because `workspace-B5DAAugy` is not a bare hash; and the
 * feature chunk names are listed below anyway so the intent is legible.
 */
const GRAMMAR_PREFIXES = [
  'javascript',
  'typescript',
  'python',
  'json',
  'bash',
  'yaml',
  'sql',
  'java',
  'csharp',
  'css',
  'html',
  'markdown',
  'github-light',
  'github-dark'
] as const

/**
 * RTWiki feature chunks whose name starts with a grammar name. Never grammars.
 *
 * Three collisions exist, all measured from `build/web/assets`:
 * `markdown-workspace` (the preview), `html-editor` (the CodeMirror surface) and
 * `shiki-service` (the engine wrapper). Each is listed explicitly rather than
 * pattern-matched away, so the list is a readable record of what collided.
 */
const FEATURE_CHUNKS = [
  'markdown-workspace',
  'markdown-columns',
  'markdown-mermaid',
  'html-editor',
  'html-preview',
  'shiki-service'
] as const

/**
 * A chunk name that is a grammar or theme.
 *
 * Matches `<grammar>-<hash>.js` where the hash is a single alphanumeric token — which
 * is what Vite emits — and never a name in {@link FEATURE_CHUNKS}.
 */
function isGrammarChunk(name: string): boolean {
  if (FEATURE_CHUNKS.some((feature) => name.startsWith(`${feature}-`))) return false
  return GRAMMAR_PREFIXES.some((prefix) => new RegExp(`^${prefix}-[A-Za-z0-9_]+\\.js$`).test(name))
}

function chunksPresent(): boolean {
  return existsSync(ASSETS) && readdirSync(ASSETS).some((f) => f.endsWith('.js'))
}

/** The static `import ... from "./x.js"` specifiers of one chunk. */
function staticImportsOf(source: string): string[] {
  const found: string[] = []
  // `import{a}from"./x.js"` and `import"./x.js"` — both are eager.
  for (const match of source.matchAll(/import\s*(?:\{[^}]*\}\s*)?from\s*"\.\/([^"]+\.js)"/g)) {
    if (match[1]) found.push(match[1] as string)
  }
  for (const match of source.matchAll(/import\s*"\.\/([^"]+\.js)"/g)) {
    if (match[1]) found.push(match[1] as string)
  }
  return found
}

/**
 * The chunks reachable from `entry` by following **static** imports only.
 *
 * This is the load the browser performs before any interaction.
 */
function eagerGraph(entryName: string, read: (name: string) => string | null): Set<string> {
  const seen = new Set<string>()
  const queue = [entryName]
  while (queue.length > 0) {
    const name = queue.pop() as string
    if (seen.has(name)) continue
    seen.add(name)
    const source = read(name)
    if (source === null) continue
    for (const dep of staticImportsOf(source)) {
      if (!seen.has(dep)) queue.push(dep)
    }
  }
  return seen
}

describe.skipIf(!chunksPresent())('syntax highlighting is lazy in the built bundle', () => {
  const names = readdirSync(ASSETS)
  const read = (name: string): string | null => {
    const file = names.includes(name) ? name : names.find((n) => n === name)
    return file ? readFileSync(join(ASSETS, file), 'utf8') : null
  }

  const entryName = names.find((n) => /^index-.*\.js$/.test(n)) ?? ''
  const workspaceName = names.find((n) => /^markdown-workspace-.*\.js$/.test(n)) ?? ''

  it('built the bundle, so these assertions are not vacuous', () => {
    expect(entryName, 'run `bun run build:web` first').not.toBe('')
    expect(workspaceName).not.toBe('')
  })

  it('emits a separate chunk per registry language', () => {
    // One chunk per language is what makes on-demand loading possible at all. A
    // bundler that inlined them would defeat the registry's whole design.
    const grammarChunks = names.filter((n) => n.endsWith('.js') && isGrammarChunk(n))
    expect(grammarChunks.length, 'expected one chunk per language/theme').toBeGreaterThanOrEqual(12)
  })

  it('pulls no grammar or theme chunk on application startup', () => {
    const eager = eagerGraph(entryName, read)
    const leaked = [...eager].filter((n) => isGrammarChunk(n))
    expect(
      leaked,
      `startup eagerly loads ${leaked.length} grammar/theme chunk(s): ${leaked.join(', ')}`
    ).toEqual([])
  })

  it('pulls no grammar or theme chunk when a Markdown page is opened', () => {
    // The Markdown workspace is a lazy route, so this is the *second* load a reader
    // triggers — opening a note. Highlighting must still not cost anything here.
    const eager = eagerGraph(workspaceName, read)
    const leaked = [...eager].filter((n) => isGrammarChunk(n))
    expect(leaked, `opening a Markdown page eagerly loads: ${leaked.join(', ')}`).toEqual([])
  })

  it('reaches the highlighter service from the Markdown workspace', () => {
    // The inverse check: the previous four could all pass if nothing imported the
    // service at all. This proves the graph is connected and genuinely lazy, rather
    // than disconnected by a mistake.
    const eager = eagerGraph(workspaceName, read)
    expect(
      [...eager].some((n) => n.startsWith('shiki-service')),
      'the Markdown workspace must reach the shiki service statically'
    ).toBe(true)
  })

  it('keeps the service chunk small, so the static import is cheap', () => {
    const service = names.find((n) => /^shiki-service-.*\.js$/.test(n)) ?? ''
    expect(service).not.toBe('')
    const size = (read(service) ?? '').length
    // Measured at 3.5 KB. The bound is generous but catches a future edit that
    // inlines a grammar into this module, which is the regression that would make the
    // static import above expensive.
    expect(size, `shiki-service grew to ${Math.round(size / 1024)} KB`).toBeLessThan(30 * 1024)
  })
})
