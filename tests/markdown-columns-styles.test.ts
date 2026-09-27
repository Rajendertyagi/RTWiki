import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { build } from 'vite'
import { COLUMNS_NOTICE_CLASS } from '../src/web/features/markdown/markdown-columns.js'

/**
 * The one test that could have caught the column feature being invisible.
 *
 * ## What went wrong, and why 1030 unit tests did not see it
 *
 * The renderer emitted `class="rt-cols"`. The stylesheet declared `.rt-cols` as
 * a **local** CSS-module class, so the build hashed it, and the shipped CSS
 * contained no `rt-cols` rule at all. The page therefore had markup and no
 * layout: no `display: flex`, and a `style="flex: 40 1 0%"` on a `<div>` that
 * was not a flex child. Twelve browser tests failed; every unit test passed.
 *
 * **A string assertion cannot catch this.** Asserting that the renderer emits
 * `rt-cols` is true whether or not any stylesheet in the app has a rule for it.
 * Checking that the name appears in the *source* stylesheet is also true here —
 * the name was written in the source and hashed on the way out. The only thing
 * that can see the difference is the pipeline that actually ships the CSS.
 *
 * So this test runs that pipeline: a real Vite build over the feature's
 * stylesheet, then asserts every class the renderer emits has a rule in the CSS
 * that came out. It costs about 350 ms — measured — and it is the only thing in
 * the suite that can tell "the name is in the source" from "a rule for it ships".
 *
 * ## Why it is not skipped in short mode
 *
 * A build-step test is exactly the kind of thing a suite skips when it is slow
 * or when a build is already running elsewhere, and skipping it would restore
 * the exact blind spot this file exists to close. It writes only to a temp
 * directory; it never touches `build/web`, so it cannot race a `build:web`.
 */

const FEATURE_DIR = resolve(import.meta.dir, '..', 'src', 'web', 'features', 'markdown')
const WORKSPACE = join(FEATURE_DIR, 'markdown-workspace.tsx')

/**
 * Every class the renderer emits, as literals.
 *
 * Written out rather than imported so this is an independent statement of what
 * the feature promises, and a rename in `markdown-columns.ts` that is not
 * mirrored here fails rather than silently following along.
 */
const EMITTED_CLASSES = [
  'rt-cols',
  'rt-cols__pane',
  'rt-cols__divider',
  'rt-cols__notice',
  'rt-unknown-directive',
  'rt-unknown-directive__name'
]

/**
 * The stylesheet the app *actually* imports, discovered from the app's own
 * source rather than hard-coded here.
 *
 * This is what makes the test measure the arrangement rather than a guess at it.
 * While the feature shipped a bare `import './markdown-columns.module.css'`, this
 * resolved to that file, the build emitted nothing, and the failure said so —
 * instead of the test reading a path that no longer existed and dying with
 * `ENOENT`, which is red but tells nobody anything.
 */
function resolveImportedStylesheet(): { path: string; specifier: string } {
  const source = readFileSync(WORKSPACE, 'utf8')
  const match = /^import '(\.\/[^']*\.css)'/m.exec(source)
  if (match === null) {
    throw new Error(
      'markdown-workspace.tsx does not bare-import a stylesheet; the ::columns rules are unreachable'
    )
  }
  const specifier = match[1] as string
  const path = resolve(FEATURE_DIR, specifier)
  // Checked here so a missing file fails the suite with a sentence about the
  // wiring, rather than with an `ENOENT` stack from inside `beforeAll`.
  if (!existsSync(path)) {
    throw new Error(
      `markdown-workspace.tsx imports ${specifier}, which does not exist; the ::columns rules are unreachable`
    )
  }
  return { path, specifier }
}

/**
 * The emitted stylesheet with its comments removed.
 *
 * Necessary, and the reason is instructive. This test builds with
 * `cssMinify: false` so a failure prints something readable — which means
 * comments survive, and this stylesheet's header explains at length why
 * `:global(...)` must not be used. Asserting on the raw text would therefore
 * match the **prohibition** and fail on a correct stylesheet. The concern is a
 * `:global(...)` in a *selector*, and a comment is not a selector.
 *
 * Stripping them also stops a commented-out rule from satisfying the class-name
 * assertions below, which would be the mirror-image false pass.
 */
let selectors: string

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

let workDir: string
let emittedCss: string
let stylesheetPath: string
let stylesheetSpecifier: string

beforeAll(async () => {
  const found = resolveImportedStylesheet()
  stylesheetPath = found.path
  stylesheetSpecifier = found.specifier
  workDir = mkdtempSync(join(tmpdir(), 'rtwiki-cols-css-'))
  // The fixture keeps the real file's **name**, because the name is what decides
  // its treatment: `x.module.css` is hashed, `x.css` is not. Copying it to a
  // fixed plain name would quietly repair the very defect this test exists to
  // find — it did, once, and the six class-rule assertions passed against a
  // stylesheet the app does not ship.
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

describe('the column stylesheet survives the build', () => {
  it('is reachable from the Markdown preview', () => {
    // Asserted first, and on its own, because a failure here explains the rest:
    // `beforeAll` throws before any CSS assertion can run.
    expect(stylesheetSpecifier, 'the preview must bare-import the column stylesheet').toBe(
      './markdown-columns.css'
    )
  })

  it('emits some CSS at all', () => {
    // The assertion that would have caught the bare `.module.css` import: a
    // side-effect import that produces an empty stylesheet. Empty, not an error
    // — which is why it went unnoticed.
    expect(
      emittedCss.length,
      `the build produced no stylesheet at all for ${stylesheetSpecifier}; the markup would render unstyled`
    ).toBeGreaterThan(0)
  })

  it.each(EMITTED_CLASSES)('emits a rule for .%s', (className) => {
    // The load-bearing assertion. A hashed name contains the original as a
    // substring, so this checks the name is a **selector** — preceded by a
    // boundary and followed by a `{` — rather than merely mentioned.
    expect(
      selectors,
      `no CSS rule shipped for .${className}; the markup would render unstyled`
    ).toMatch(new RegExp(`(^|[\\s,>+~])\\.${className}(?![\\w-])`))
  })

  it('does not leak :global() into the output', () => {
    // `:global(...)` is CSS-modules syntax. In a plain stylesheet it reaches the
    // browser verbatim, where it is an unknown pseudo-class that matches
    // nothing — a second, quieter way for this feature to render unstyled.
    // Measured: a plain `.css` with `:global(.rt-cols){display:flex}` builds
    // cleanly and emits exactly that, which matches nothing.
    expect(selectors, ':global() passed through to the browser as a selector').not.toContain(
      ':global('
    )
  })

  it('gives the row a flex layout, which is the whole point of the feature', () => {
    // Not a name check: the declaration the geometry depends on. Without
    // `display: flex` the panes stack as blocks and the inline `flex` on each
    // does nothing at all.
    expect(selectors).toMatch(/\.rt-cols\s*\{[^}]*display:\s*flex/)
  })

  it('gives the divider its pointer affordance and hit area', () => {
    // A missing 6px hit-area is what a drag test reports as "the pane did not
    // move", so its absence is worth naming directly.
    expect(selectors).toMatch(/\.rt-cols__divider\s*\{[^}]*cursor:\s*col-resize/)
    expect(selectors).toMatch(/--rtwiki-divider-hit-width/)
  })
})

describe('the stylesheet is wired to the module that renders it', () => {
  it('is a plain .css, not a CSS module', () => {
    // Measured: a bare side-effect import of a `*.module.css` contributes no CSS
    // in this build. A file named `.module.css` can only be shipped through a
    // class-map import, which would mean hashed names — and the markup is a
    // string, so hashed names cannot reach it.
    expect(basename(stylesheetPath)).toBe('markdown-columns.css')
    expect(
      existsSync(join(FEATURE_DIR, 'markdown-columns.module.css')),
      'a .module.css twin would be a second, unstyled copy of these rules'
    ).toBe(false)
  })

  it('names in the renderer and in the stylesheet agree', () => {
    // The duplication between a TypeScript constant and a stylesheet selector is
    // inherent — a stylesheet cannot import a constant. This is the cheap,
    // always-on half of the guard: it catches a rename that was not mirrored.
    // It cannot catch the hashing bug on its own, which is what the Vite build
    // above is for; both are needed.
    const source = readFileSync(stylesheetPath, 'utf8')
    expect(COLUMNS_NOTICE_CLASS, 'the constant under test is the one the renderer emits').toBe(
      'rt-cols__notice'
    )
    for (const className of EMITTED_CLASSES) {
      expect(source, `.${className} has no rule in the stylesheet source`).toContain(
        `.${className}`
      )
    }
  })
})
