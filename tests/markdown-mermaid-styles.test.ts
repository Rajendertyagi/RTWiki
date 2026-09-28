import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { build } from 'vite'
import { MERMAID_CLASS } from '../src/web/features/markdown/markdown-mermaid.js'
import {
  MERMAID_ERROR_CLASS,
  MERMAID_STATE_ATTRIBUTE,
  MERMAID_STATE_ERROR,
  MERMAID_STATE_PENDING,
  MERMAID_STATE_RENDERED
} from '../src/web/features/markdown/markdown-mermaid-hydrate.js'

/**
 * The ` ```mermaid ` diagram stylesheet survives the build.
 *
 * ## Why this test exists at all
 *
 * Because the same mistake has already been made twice in this repository, and
 * it is invisible to every other kind of test. `:::columns` shipped with correct
 * markup, correct interactions in a unit test, and **no stylesheet at all**,
 * because the renderer emitted a string class name while the rules were declared
 * as CSS-module locals and hashed on the way out. Twelve browser tests failed and
 * no unit test did.
 *
 * A string assertion cannot catch that. Asserting the renderer emits `rt-mermaid`
 * is true whether or not a rule for it ships; checking the *source* stylesheet
 * contains `.rt-mermaid` is also true, because the name was written there and
 * hashed on the way out. Only the pipeline that actually ships the CSS can tell
 * "the name is in the source" from "a rule for it ships", so this test runs it.
 *
 * ## Why it is not skipped in short mode
 *
 * A build-step test is exactly the kind of thing a suite skips when a build is
 * already running elsewhere, and skipping it restores the blind spot this file
 * exists to close. It writes only to a temp directory and never touches
 * `build/web`, so it cannot race a `build:web`.
 */

const FEATURE_DIR = resolve(import.meta.dir, '..', 'src', 'web', 'features', 'markdown')
const WORKSPACE = join(FEATURE_DIR, 'markdown-workspace.tsx')

/**
 * The stylesheet this feature imports, found by **name** rather than by
 * position.
 *
 * `markdown-workspace.tsx` bare-imports two plain stylesheets, and the existing
 * `tests/markdown-columns-styles.test.ts` discovers its own by taking the first
 * one. Matching on the feature's file name keeps the two tests independent: a new
 * stylesheet added above the column one cannot silently repoint either of them.
 */
function resolveImportedStylesheet(): { path: string; specifier: string } {
  const source = readFileSync(WORKSPACE, 'utf8')
  const match = /^import '(\.\/markdown-mermaid\.css)'/m.exec(source)
  if (match === null) {
    throw new Error(
      'markdown-workspace.tsx does not bare-import markdown-mermaid.css; the diagram rules are unreachable'
    )
  }
  const specifier = match[1] as string
  const path = resolve(FEATURE_DIR, specifier)
  if (!existsSync(path)) {
    throw new Error(
      `markdown-workspace.tsx imports ${specifier}, which does not exist; the diagram rules are unreachable`
    )
  }
  return { path, specifier }
}

/** The emitted stylesheet with its comments removed. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

let workDir: string
let emittedCss: string
let stylesheetPath: string
let stylesheetSpecifier: string
let selectors: string

beforeAll(async () => {
  const found = resolveImportedStylesheet()
  stylesheetPath = found.path
  stylesheetSpecifier = found.specifier
  workDir = mkdtempSync(join(tmpdir(), 'rtwiki-mermaid-css-'))
  // The fixture keeps the real file's **name**, because the name is what decides
  // its treatment: `x.module.css` is hashed, `x.css` is not.
  const fixture = basename(stylesheetPath)
  writeFileSync(join(workDir, 'entry.js'), `import './${fixture}'\nexport const probe = 1\n`)
  writeFileSync(join(workDir, fixture), readFileSync(stylesheetPath, 'utf8'))
  await build({
    root: workDir,
    logLevel: 'error',
    build: {
      outDir: join(workDir, 'out'),
      emptyOutDir: true,
      target: 'es2024',
      minify: false,
      cssMinify: false,
      lib: { entry: join(workDir, 'entry.js'), formats: ['es'], fileName: 'probe' }
    }
  })
  const files = readdirSync(join(workDir, 'out')).filter((name) => name.endsWith('.css'))
  emittedCss =
    files.length === 0 ? '' : readFileSync(join(workDir, 'out', files[0] as string), 'utf8')
  selectors = stripCssComments(emittedCss)
})

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true })
})

describe('the diagram stylesheet survives the build', () => {
  it('is reachable from the Markdown preview', () => {
    // First, and on its own: a failure here explains every assertion after it.
    expect(stylesheetSpecifier, 'the preview must bare-import the diagram stylesheet').toBe(
      './markdown-mermaid.css'
    )
  })

  it('emits some CSS at all', () => {
    // The assertion that would have caught a bare `.module.css` side-effect
    // import: an empty stylesheet. Empty, not an error, which is why it goes
    // unnoticed.
    expect(
      emittedCss.length,
      `the build produced no stylesheet for ${stylesheetSpecifier}; a diagram would render unstyled`
    ).toBeGreaterThan(0)
  })

  it.each([MERMAID_CLASS, MERMAID_ERROR_CLASS])('emits a rule for .%s', (className) => {
    // A hashed name contains the original as a substring, so this checks the name
    // is a **selector** - preceded by a boundary, followed by a `{` - rather than
    // merely mentioned.
    expect(
      selectors,
      `no CSS rule shipped for .${className}; the markup would render unstyled`
    ).toMatch(new RegExp(`(^|[\\s,>+~])\\.${className}(?![\\w-])`))
  })

  it('does not leak :global() into the output', () => {
    // `:global(...)` is CSS-modules syntax. In a plain stylesheet it reaches the
    // browser verbatim, where it is an unknown pseudo-class matching nothing -
    // a second, quieter way for this feature to render unstyled.
    expect(selectors, ':global() passed through to the browser as a selector').not.toContain(
      ':global('
    )
  })

  it('is a plain .css, not a CSS module', () => {
    // Measured: a bare side-effect import of a `*.module.css` contributes no CSS
    // in this build. A `.module.css` twin could only ship through a class-map
    // import, which would mean hashed names - and the placeholder is a string,
    // so hashed names cannot reach it.
    expect(basename(stylesheetPath)).toBe('markdown-mermaid.css')
    expect(
      existsSync(join(FEATURE_DIR, 'markdown-mermaid.module.css')),
      'a .module.css twin would be a second, unstyled copy of these rules'
    ).toBe(false)
  })

  it('keeps the diagram inside the page', () => {
    // Not a name check: the two declarations a wide diagram needs to stop
    // pushing the page sideways. Mermaid emits an intrinsic width, so without
    // these a wide diagram overflows the preview.
    expect(selectors).toMatch(new RegExp(`\\.${MERMAID_CLASS}\\s*\\{[^}]*max-width:\\s*100%`))
    expect(selectors).toMatch(new RegExp(`\\.${MERMAID_CLASS}\\s*>\\s*svg\\s*\\{[^}]*max-width`))
  })

  it('gives a failed diagram a message that reads as a problem', () => {
    expect(selectors).toMatch(
      new RegExp(`\\.${MERMAID_ERROR_CLASS}\\s*\\{[^}]*color:\\s*var\\(--mantine-color-red`)
    )
  })
})

describe('the stylesheet and the module that renders it agree', () => {
  it('uses the same class names the module writes', () => {
    // The duplication between a TypeScript constant and a stylesheet selector is
    // inherent - a stylesheet cannot import a constant. This is the cheap,
    // always-on half of the guard; the Vite build above is the half that can see
    // the hashing bug. Both are needed.
    const source = readFileSync(stylesheetPath, 'utf8')
    expect(MERMAID_CLASS, 'the constant under test is the one the parser emits').toBe('rt-mermaid')
    expect(MERMAID_ERROR_CLASS).toBe('rt-mermaid__error')
    for (const className of [MERMAID_CLASS, MERMAID_ERROR_CLASS]) {
      expect(source, `.${className} has no rule in the stylesheet source`).toContain(
        `.${className}`
      )
    }
  })

  it('documents the no-layout-hole rule in the same place it is implemented', () => {
    /**
     * The three render states are carried by the `hidden` attribute and the
     * `data-rt-state` value, not by CSS - which is why there is deliberately no
     * `[data-rt-state]` display rule here. A stylesheet comment that implied
     * otherwise would be the beginning of a second, disagreeing description.
     */
    const source = readFileSync(stylesheetPath, 'utf8')
    expect(source, 'the stylesheet must state where the states actually live').toContain(
      'data-rt-state'
    )
    expect(source).not.toMatch(new RegExp(`\\[${MERMAID_STATE_ATTRIBUTE}\\s*\\]=`))
  })

  it('agrees with the module on the state values it names', () => {
    // Cheap, and it catches the case where the stylesheet's prose and the
    // module's constants drift apart - the two are only connected by a
    // convention, and nothing else would say so.
    const source = readFileSync(stylesheetPath, 'utf8')
    for (const state of [MERMAID_STATE_PENDING, MERMAID_STATE_RENDERED, MERMAID_STATE_ERROR]) {
      expect(source, `the stylesheet never mentions the "${state}" state`).toContain(state)
    }
  })
})
