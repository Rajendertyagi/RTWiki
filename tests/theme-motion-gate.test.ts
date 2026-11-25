import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Motion-literal gate — separate from Gate C9 (literal colours) in
 * `theme-consumers.test.ts` and Gate S1 (spacing) in `theme-spacing-gate.test.ts`.
 * Each guards a different value class with its own baseline.
 *
 * `MOTION` in `src/web/config/index.ts` is the authoritative home for shared
 * application motion; `css-variables.ts` emits it as `--rtwiki-motion-*`.
 * This gate is ADDITIVE: removing a literal (tokenization) is always fine, but
 * any NEW duration literal outside the reviewed baseline fails.
 *
 * Equal durations are NOT evidence of a shared token: tab (`ease`), tree hover
 * (`ease-out`) and card hover (`ease`) are separate interaction decisions that
 * happen to share 150ms. Do not consolidate them by matching numbers.
 */

const REPO_ROOT = join(import.meta.dir, '..')
const WEB_ROOT = join(REPO_ROOT, 'src', 'web')
const CONFIG_PATH = join(WEB_ROOT, 'config', 'index.ts')
const CSS_VARS_PATH = join(WEB_ROOT, 'theme', 'css-variables.ts')
const CUSTOMIZATION_PATH = join(WEB_ROOT, 'theme', 'customization.css')
const PAGE_CARD_PATH = join(WEB_ROOT, 'features', 'dashboard', 'page-card.module.css')

function collectFiles(dir: string, ext: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collectFiles(full, ext, out)
    else if (full.endsWith(ext)) out.push(full)
  }
  return out
}

/** Blank out comments while preserving newlines and 1-based line numbers. */
function stripComments(source: string): string {
  const chars = source.split('')
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to; i++) {
      if (chars[i] !== '\n') chars[i] = ' '
    }
  }
  let i = 0
  while (i < source.length) {
    const current = source[i]
    const next = source[i + 1]
    if (current === '/' && next === '*') {
      const start = i
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++
      blank(start, Math.min(source.length, i + 2))
      i += 2
      continue
    }
    if (current === '/' && next === '/') {
      const start = i
      while (i < source.length && source[i] !== '\n') i++
      blank(start, i)
      continue
    }
    if (current === "'" || current === '"' || current === '`') {
      const quote = current
      i++
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i] === quote) {
          i++
          break
        }
        i++
      }
      continue
    }
    i++
  }
  return chars.join('')
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/** transition/animation declarations plus custom properties that define a duration. */
const MOTION_PROPERTY =
  /^(?:transition|animation)(?:-(?:duration|delay))?$|^--[\w-]*(?:motion|duration|transition|animation)[\w-]*$/
/** Authored duration literals: integer or decimal milliseconds / seconds. */
const DURATION_RE = /\b\d+(?:\.\d+)?(?:ms|s)\b/g

interface FoundDuration {
  file: string
  line: number
  prop: string
  value: string
}

function findDurationLiterals(source: string, file: string): FoundDuration[] {
  const code = stripComments(source)
  const found: FoundDuration[] = []
  for (const decl of code.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
    const prop = decl[1] ?? ''
    if (!MOTION_PROPERTY.test(prop)) continue
    const value = decl[2] ?? ''
    const line = code.slice(0, decl.index).split('\n').length
    for (const match of value.matchAll(DURATION_RE)) {
      found.push({ file, line, prop, value: match[0] })
    }
  }
  return found
}

/**
 * Removes the `@media (prefers-reduced-motion: reduce)` block so a test about
 * *authored* token values does not trip over the render-time override. Braces
 * are counted from the media query's opening brace to find its matching close.
 */
function withoutReducedMotionOverride(source: string): string {
  const marker = '@media (prefers-reduced-motion: reduce)'
  const start = source.indexOf(marker)
  if (start === -1) return source
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(0, start) + source.slice(i + 1)
    }
  }
  return source.slice(0, start)
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

type Disposition = 'allowlist' | 'tracked-debt'

interface BaselineEntry {
  file: string
  value: string
  count: number
  disposition: Disposition
  rationale: string
}

/**
 * Every duration literal currently present in a motion declaration, keyed by
 * (file, value) with an occurrence count — the C9 model. Line numbers are
 * deliberately absent: moving a declaration must not create a false failure.
 * Adding a new value, or a new occurrence of an existing value, does.
 *
 * All three entries are `allowlist`: each is a documented exemption with a
 * rationale, not debt awaiting tokenization.
 */
const MOTION_BASELINE: readonly BaselineEntry[] = [
  {
    file: 'src/web/components/window-chrome.module.css',
    value: '75ms',
    count: 2,
    disposition: 'allowlist',
    rationale:
      'platform-specific caption-button feedback (background-color/color, linear); no shared app token applies'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '120ms',
    count: 1,
    disposition: 'allowlist',
    rationale:
      'document typography (link text-decoration-color); approved exclusion per the typography decision'
  },
  {
    file: 'src/web/theme/customization.css',
    value: '80ms',
    count: 1,
    disposition: 'allowlist',
    rationale:
      'tree-specific quick expander feedback; single use, owner decision 3 preserves its home and value'
  },
  {
    file: 'src/web/theme/customization.css',
    value: '0ms',
    count: 5,
    disposition: 'allowlist',
    rationale:
      'reduced-motion render-time override of the five --rtwiki-motion-* tokens; zero duration, not an authored interaction value'
  }
]

describe('motion-literal gate', () => {
  const cssFiles = collectFiles(WEB_ROOT, '.css')

  it('scans the whole web stylesheet tree', () => {
    expect(cssFiles.length).toBeGreaterThan(20)
    expect(cssFiles.some((file) => file.endsWith('customization.css'))).toBe(true)
  })

  it('is class-aware — only motion declarations are scanned', () => {
    const synthetic = [
      '.a { transition: background-color 150ms ease; }',
      '.b { --rtwiki-motion-fast: 120ms; }',
      '.c { border-radius: 150px; width: 150px; }'
    ].join('\n')
    const hits = findDurationLiterals(synthetic, 'synthetic.css')
    expect(hits.map((hit) => hit.value)).toEqual(['150ms', '120ms'])
  })

  it('every baseline entry has a valid disposition and a rationale', () => {
    for (const entry of MOTION_BASELINE) {
      expect(['allowlist', 'tracked-debt']).toContain(entry.disposition)
      expect(entry.rationale.length).toBeGreaterThan(0)
      expect(entry.count).toBeGreaterThan(0)
    }
  })

  it('every duration literal is in the reviewed baseline', () => {
    const allowed = new Map<string, number>()
    for (const entry of MOTION_BASELINE) {
      const key = `${entry.file}::${entry.value}`
      allowed.set(key, (allowed.get(key) ?? 0) + entry.count)
    }

    const foundByKey = new Map<string, FoundDuration[]>()
    for (const file of cssFiles) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, '/')
      for (const literal of findDurationLiterals(readFileSync(file, 'utf8'), rel)) {
        const key = `${literal.file}::${literal.value}`
        const list = foundByKey.get(key) ?? []
        list.push(literal)
        foundByKey.set(key, list)
      }
    }

    const unexpected: string[] = []
    for (const [key, list] of foundByKey) {
      const permitted = allowed.get(key) ?? 0
      if (list.length > permitted) {
        const lines = list.map((literal) => literal.line).join(', ')
        unexpected.push(`${key} — found ${list.length}, baseline ${permitted} (lines ${lines})`)
      }
    }
    expect(
      unexpected,
      `New duration literal(s) not in the motion baseline:\n${unexpected.join('\n')}`
    ).toEqual([])
  })

  it('MOTION owns treeHover and cardHover as separate 150ms values', () => {
    const config = readFileSync(CONFIG_PATH, 'utf8')
    expect(config).toMatch(/treeHover:\s*150\b/)
    expect(config).toMatch(/cardHover:\s*150\b/)
    expect(config).toMatch(/fast:\s*120\b/)
    expect(config).toMatch(/tab:\s*150\b/)
  })

  it('css-variables.ts emits all four motion tokens from MOTION', () => {
    const bridge = readFileSync(CSS_VARS_PATH, 'utf8')
    // Build the expected source line so the literal `${...}` is not written as
    // a plain string (which biome's noTemplateCurlyInString flags).
    const emission = (token: string, key: string): string =>
      `'--rtwiki-motion-${token}': \`\${MOTION.${key}}ms\``
    expect(bridge).toContain(emission('fast', 'fast'))
    expect(bridge).toContain(emission('tab', 'tab'))
    expect(bridge).toContain(emission('tree-hover', 'treeHover'))
    expect(bridge).toContain(emission('card-hover', 'cardHover'))
  })

  it('page-card consumes the card-hover token and has no 150ms literal', () => {
    const card = readFileSync(PAGE_CARD_PATH, 'utf8')
    expect(card).toContain('var(--rtwiki-motion-card-hover)')
    expect(card).not.toMatch(/\b150ms\b/)
    // Easing and property set are preserved exactly.
    expect(card).toContain('box-shadow var(--rtwiki-motion-card-hover) ease')
    expect(card).toContain('border-color var(--rtwiki-motion-card-hover) ease')
    expect(card).toContain('transform var(--rtwiki-motion-card-hover) ease')
  })

  it('customization.css no longer statically defines the tree-hover token', () => {
    const css = readFileSync(CUSTOMIZATION_PATH, 'utf8')
    // The reduced-motion media query overrides the token at render time; that
    // is not a static definition. Strip that block before asserting the
    // authored value still lives in css-variables.ts / config/index.ts.
    const authored = withoutReducedMotionOverride(css)
    expect(authored).not.toMatch(/--rtwiki-motion-tree-hover\s*:/)
    // The single-use tree-quick token stays put.
    expect(authored).toMatch(/--rtwiki-motion-tree-quick:\s*80ms/)
  })

  it('the reduced-motion override collapses every RTWiki motion token to zero', () => {
    const css = readFileSync(CUSTOMIZATION_PATH, 'utf8')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    for (const token of ['fast', 'tab', 'tree-hover', 'card-hover', 'tree-quick']) {
      expect(css, `reduced-motion override for --rtwiki-motion-${token}`).toMatch(
        new RegExp(`--rtwiki-motion-${token}:\\s*0ms\\s*!important`)
      )
    }
  })
})
