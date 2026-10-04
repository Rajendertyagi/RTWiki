import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { build } from 'vite'
import {
  COLUMNS_NOTICE_CLASS,
  COLUMNS_PANE_FLEX_FALLBACK,
  COLUMNS_PANE_FLEX_PROPERTY,
  renderColumnChild,
  renderColumnsDirective
} from '../src/web/features/markdown/markdown-columns.js'

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
 *
 * ## Matched by name, not by position
 *
 * This originally took the **first** bare `.css` import in the file, which was
 * unambiguous only while there was exactly one. `markdown-content.css` now joins
 * `markdown-columns.css` and `markdown-mermaid.css` as a third plain stylesheet,
 * and alphabetically it sorts first — so this resolved to the wrong file and every
 * class assertion below then failed against an unrelated stylesheet. Measured: 14
 * failures that said "no CSS rule shipped for `.rt-cols`" when the rule was
 * present and shipped exactly as before.
 *
 * The lesson is worth recording, because the failure mode is misleading rather
 * than merely wrong: a test that finds its subject by position reports a *missing
 * rule* when it has actually read the *wrong file*. This asks for the file whose
 * name the assertions are about.
 */
function resolveImportedStylesheet(): { path: string; specifier: string } {
  const source = readFileSync(WORKSPACE, 'utf8')
  const match = /^import '(\.\/markdown-columns\.css)'/m.exec(source)
  if (match === null) {
    throw new Error(
      'markdown-workspace.tsx does not bare-import ./markdown-columns.css; the ::columns rules are unreachable'
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

/**
 * ## The dead `flex` rule, and the test that can see it
 *
 * A pane's width is a per-instance number, so it cannot be written in a
 * stylesheet — it has to be an inline declaration. And an inline declaration wins
 * every cascade contest it enters. So while the width was `flex: N 1 0%` inline,
 * a `flex` rule in this file was **dead weight that read as load-bearing**: it
 * would have compiled, shipped, matched every pane, and changed nothing.
 *
 * **Nothing in the toolchain reports that.** Measured, both halves:
 * - CSS coverage answers "did this selector match an element", which the dead rule
 *   did. It does not answer "which declaration won".
 * - The stylelint family has no cascade model at all, so it cannot answer it
 *   either.
 * - The markup is a string injected through `dangerouslySetInnerHTML`, so there is
 *   no DOM to measure and no computed style to assert against.
 *
 * The fix was to route the number through a custom property, which moves the
 * shorthand into this file and leaves only a variable to pass across. That is
 * what makes the pairing **checkable**: the rule and the property are two pieces
 * of text in two different files, and this file builds the real one and then
 * checks that it names the other.
 *
 * Each half is necessary and neither is sufficient. A rule with no property is
 * dead and still passes a class-name check; a property with no rule is ignored
 * and still passes an emit check.
 */
describe('the pane width is routed to the stylesheet, not around it', () => {
  it('ships a flex rule for the pane, and it references the property', () => {
    /**
     * The assertion that would have caught a dead rule, stated on the CSS that
     * **came out of the build** rather than on the source.
     *
     * On the source this is true of any `flex` declaration whatsoever, dead or
     * not — which is exactly the blind spot. On the emitted CSS it is a statement
     * about what a browser will parse, and it can only be made here because this
     * file runs the real pipeline.
     */
    expect(paneFlexDeclaration(), 'the pane has no shipped flex declaration').not.toBeNull()
    expect(
      paneFlexDeclaration(),
      'the shipped flex rule must read the property, or the rule cannot win'
    ).toContain(`var(${COLUMNS_PANE_FLEX_PROPERTY}`)
  })

  it('emits the property on every pane, and no inline shorthand to beat the rule', () => {
    /**
     * The other half, and the one that makes the first half mean something.
     *
     * Checked against the **render path** rather than a hand-written fixture,
     * because that is the whole lesson of `markdown-columns-wiring.test.ts`: a
     * fixture can agree with the emitter while the emitter is wrong, and then
     * every interaction assertion passes against a row that is never produced.
     */
    // A child, as `renderColumnChild` writes it — the orphan/reset shape.
    const child = renderColumnChild((value) => value, {
      name: 'column',
      content: 'A',
      type: 'containerDirective'
    })
    // A row, as `renderColumnsDirective` writes it, with the pane flexed 40/60.
    const row = renderColumnsDirective((value) => value, {
      name: 'columns',
      attributes: { left: '40' },
      content: '<p>L</p>\n<hr />\n<p>R</p>',
      type: 'containerDirective'
    })
    for (const html of [child, row]) {
      expect(html, 'the pane must carry the grow factor').toContain(
        `${COLUMNS_PANE_FLEX_PROPERTY}: `
      )
      // An inline shorthand is what made the rule dead. This is the only
      // assertion in the suite that could have said so, and it says it about the
      // real emitter.
      expect(html, 'an inline flex shorthand would beat the stylesheet rule').not.toContain(
        'style="flex'
      )
    }
  })

  it('resolves a pane with no property to an equal share, not to an invalid rule', () => {
    /**
     * The `, 1` in the `var()`, and why it is load-bearing.
     *
     * A `var()` with **no** fallback makes the whole declaration invalid at
     * computed-value time, and each longhand then takes its *initial* value
     * rather than a previous declaration. With the fallback removed, a browser
     * resolves this to **`0 1 auto`** — measured, not assumed: `flex-grow: 0`, so
     * the panes stop growing to share the row and size to their content instead.
     * It is not a zero-width collapse, which is the wrong guess and worth
     * correcting here, because the wrong guess is what makes a reader look for
     * the fault somewhere else.
     *
     * With the fallback, a pane whose property went missing takes an equal
     * share, which is what "no width asked for" means everywhere else in this
     * feature.
     *
     * The consequence above is settled in a real engine by
     * `tests/browser/markdown-columns-sizing.pwspec.ts`, which removes the
     * property from a live pane and asserts the resolved value and the real
     * widths. This test cannot observe it and does not pretend to.
     *
     * **The limit of this test, stated plainly:** it is a resolver written here,
     * not a layout engine. jsdom cannot back it — measured, its
     * `getComputedStyle` returns the *unsubstituted* `var(--rt-cols-pane-flex, 1)
     * 1 0%`, so no unit test in this repo can observe real cascade resolution for
     * a custom property. What this pins is the shape of the shipped declaration
     * (the fallback is present and is the value the renderer uses as its reset)
     * and that the two forms differ. The only thing that can settle the resolved
     * value in a real engine is a browser `getComputedStyle` assertion, which this
     * suite does not run.
     */
    const shipped = paneFlexDeclaration()
    expect(shipped, 'the shipped rule must be readable for this to mean anything').not.toBeNull()

    // The fallback the stylesheet actually ships, extracted rather than restated.
    const fallback = /var\(\s*--rt-cols-pane-flex\s*,\s*([^)]*)\)/.exec(shipped as string)?.[1]
    expect(fallback, 'the shipped var() must carry a fallback').toBeDefined()
    expect(fallback?.trim(), 'the fallback must be the value the renderer resets a pane to').toBe(
      String(COLUMNS_PANE_FLEX_FALLBACK)
    )

    // A pane with no property: a valid declaration, an equal share.
    expect(resolveFlex(shipped as string, null)).toBe('1 1 0%')
    // A pane with one: the authored share.
    expect(resolveFlex(shipped as string, '40')).toBe('40 1 0%')
    // The same declaration with the fallback removed, for contrast. This is the
    // shape that fails, and the assertion says it fails, so the fallback cannot
    // be dropped without a test going red.
    expect(resolveFlex('var(--rt-cols-pane-flex) 1 0%', null)).toBeNull()
  })
})

/**
 * The `flex` declaration on `.rt-cols__pane`, **as the build emitted it**.
 *
 * Read out of the built CSS rather than restated, so that dropping the rule, or
 * changing its fallback, fails the assertions above instead of being papered over
 * by a literal in this file.
 */
function paneFlexDeclaration(): string | null {
  let found: string | null = null
  for (const match of selectors.matchAll(/\.rt-cols__pane(?![-\w])[^{]*\{([^}]*)\}/g)) {
    const body = match[1] as string
    const declaration = /(?:^|;)\s*flex\s*:\s*([^;]+)/.exec(body)
    // Several rules target the pane (the media query is one of them); the one that
    // carries a `flex` declaration is the one under test.
    if (declaration !== null) found = (declaration[1] as string).trim()
  }
  return found
}

/**
 * Resolves one `flex` declaration the way a browser does, for the only two cases
 * this stylesheet can be in.
 *
 * Implements the two rules that matter and nothing else, deliberately:
 * - a `var()` whose property the element sets is replaced by that value;
 * - a `var()` with a fallback, and no property, is replaced by the fallback;
 * - a `var()` with **no** fallback, and no property, makes the declaration
 *   invalid at computed-value time, which is returned as `null` because that is
 *   what a browser does to it — not "the previous value", not "0".
 */
function resolveFlex(declaration: string, customValue: string | null): string | null {
  let invalid = false
  const substituted = declaration.replace(
    // `name` is captured but not read: the substitution keys off whether the
    // element sets *a* value, not off which property was named, because this
    // stylesheet has exactly one. Kept in the pattern so the fallback group
    // stays the second capture.
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g,
    (_whole, _name: string, fallback?: string) => {
      if (customValue !== null) return customValue
      if (fallback !== undefined) return fallback.trim()
      invalid = true
      return ''
    }
  )
  return invalid ? null : substituted.replace(/\s+/g, ' ').trim()
}
