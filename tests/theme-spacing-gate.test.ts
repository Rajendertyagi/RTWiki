import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Gate S1 — spacing-class literal values in `src/web/**\/*.css`.
 *
 * This is deliberately separate from Gate C9 (literal colours) in
 * `theme-consumers.test.ts`. C9 must stay untouched: it guards a different
 * value class with its own 15-entry baseline.
 *
 * The gate is ADDITIVE, like C9: it does not require tracked-debt literals to
 * be tokenized today, but any NEW spacing literal outside the reviewed
 * baseline fails. Removing a literal (tokenization work) is always fine.
 *
 * CLASS-AWARE: only spacing-class properties are scanned — `gap`/`padding`/
 * `margin` longhands and custom properties whose names carry a spacing word.
 * Radius, border, accent, shadow, typography and platform-geometry literals
 * are never examined here, so a 4px/6px radius cannot false-pass as spacing
 * (and a 4px/6px spacing token cannot false-pass a radius literal).
 */

const REPO_ROOT = join(import.meta.dir, '..')
const WEB_ROOT = join(REPO_ROOT, 'src', 'web')

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
// Class-aware scanner
// ---------------------------------------------------------------------------

const SPACING_LONGHAND =
  /^(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?$/
const SPACING_CUSTOM = /^--[\w-]*(?:gap|pad|padding|margin|inset|offset|spacing|space)[\w-]*$/

/** `letter-spacing` is typography, not spacing — never treat it as a token candidate. */
function isSpacingProperty(prop: string): boolean {
  if (prop.includes('letter-spacing')) return false
  return SPACING_LONGHAND.test(prop) || SPACING_CUSTOM.test(prop)
}

/** px/rem/em/% lengths (including bare 0), plus layout keywords. */
const LENGTH_RE = /-?\d+(?:\.\d+)?(?:px|rem|em|%)|\b0\b/g
const KEYWORD_RE = /\b(?:auto|none|flex)\b/g

interface FoundLiteral {
  file: string
  line: number
  prop: string
  value: string
}

function findSpacingLiterals(source: string, file: string): FoundLiteral[] {
  const code = stripComments(source)
  const found: FoundLiteral[] = []
  for (const decl of code.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
    const prop = decl[1] ?? ''
    if (!isSpacingProperty(prop)) continue
    const raw = (decl[2] ?? '').replace(/\s+/g, ' ').trim()
    const line = code.slice(0, decl.index).split('\n').length
    // A calc() expression is recorded whole: it is an SSoT var combined with
    // intrinsic values, and the exact expression is what the baseline reviews.
    if (raw.includes('calc(')) {
      found.push({ file, line, prop, value: raw })
      continue
    }
    for (const match of raw.matchAll(LENGTH_RE)) {
      found.push({ file, line, prop, value: match[0] })
    }
    for (const match of raw.matchAll(KEYWORD_RE)) {
      found.push({ file, line, prop, value: match[0] })
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// S1 baseline
// ---------------------------------------------------------------------------

type Disposition = 'allowlist' | 'tracked-debt'

/**
 * Value-level exemptions. These are semantically intrinsic or layout-mechanical
 * and have no SSoT token equivalent. Every exemption is recorded here with a
 * disposition and rationale; the "exemption table is closed" test below fails
 * if a new value is added to the code without being recorded here (and vice
 * versa). This is the exemption half of the S1 baseline.
 */
const INTRINSIC_EXEMPTIONS: Readonly<
  Record<string, { disposition: Disposition; rationale: string }>
> = {
  '0': { disposition: 'allowlist', rationale: 'no space — intrinsic zero, not a design value' },
  '0px': { disposition: 'allowlist', rationale: 'no space, explicit unit form' },
  '1px': { disposition: 'allowlist', rationale: 'hairline / optical nudge' },
  '-1px': { disposition: 'allowlist', rationale: 'hairline / optical nudge (negative)' },
  '2px': { disposition: 'allowlist', rationale: 'owner decision: 2px stays a plain allowed value' },
  '-2px': { disposition: 'allowlist', rationale: 'owner decision: 2px stays plain (negative)' },
  '100%': { disposition: 'allowlist', rationale: 'fill — layout keyword, not a spacing step' },
  auto: { disposition: 'allowlist', rationale: 'layout keyword — browser-computed space' },
  none: { disposition: 'allowlist', rationale: 'layout keyword — absence of space' },
  flex: { disposition: 'allowlist', rationale: 'layout keyword — flex sizing, not a length' }
}

interface BaselineEntry {
  file: string
  value: string
  count: number
  disposition: Disposition
  note: string
}

/**
 * Every non-exempt spacing literal currently present in `src/web/**\/*.css`,
 * keyed by (file, value) with an occurrence count — the C9 model. Line numbers
 * are deliberately absent: moving a declaration must not create a false
 * failure. Adding a new value, or a new occurrence of an existing value, does.
 *
 * All entries are either `tracked-debt` (a value with no Mantine spacing token
 * — content em-scale, or a component-specific px with no step) or `allowlist`
 * (a calc() that already combines an SSoT var with intrinsic values).
 */
const SPACING_BASELINE: readonly BaselineEntry[] = [
  // Component-specific px with no Mantine spacing step.
  {
    file: 'src/web/features/dashboard/page-card.module.css',
    value: '28px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'title right padding — reserved room for the 3-dot menu'
  },
  {
    file: 'src/web/features/dashboard/page-card.module.css',
    value: '7px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'type chip inline padding — 7px has no spacing token (finding)'
  },
  {
    file: 'src/web/features/settings/debug-log-viewer.module.css',
    value: '22px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'meta label indent — no spacing token'
  },
  {
    file: 'src/web/theme/customization.css',
    value: '14px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'tree context-menu inline padding — no spacing token'
  },
  {
    file: 'src/web/theme/customization.css',
    value: '54px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'BlockNote document inset — third-party geometry, no token'
  },

  // calc() expressions: SSoT var combined with intrinsic values (plan exemption).
  {
    file: 'src/web/features/sidebar/page-tree.module.css',
    value: 'calc(-1 * var(--rtwiki-tree-indent-step) + 2px)',
    count: 1,
    disposition: 'allowlist',
    note: 'negative indent step plus intrinsic 2px hairline'
  },
  {
    file: 'src/web/features/workspace/right-sidebar.module.css',
    value: 'calc(8px + (var(--rtwiki-indent-level, 1) - 1) * 12px)',
    count: 1,
    disposition: 'allowlist',
    note: 'indent level derived from spacing steps; runtime-driven'
  },

  // Content typography em-scale. Separate value class (content prose), owned by
  // a later typography phase — deliberately not snapped to UI spacing steps.
  {
    file: 'src/web/features/markdown/markdown-columns.css',
    value: '0.35em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-columns.css',
    value: '0.5em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-columns.css',
    value: '0.75em',
    count: 2,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '-1.5em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale hanging indent'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.05em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale padding'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.1em',
    count: 3,
    disposition: 'tracked-debt',
    note: 'content em-scale padding'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.2em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale padding'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.22em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.25em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.28em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale padding'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.3em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.34em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale padding'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.35em',
    count: 4,
    disposition: 'tracked-debt',
    note: 'content em-scale margin/padding'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.4em',
    count: 3,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.45em',
    count: 2,
    disposition: 'tracked-debt',
    note: 'content em-scale margin/padding'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.5em',
    count: 2,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.55em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.9em',
    count: 2,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '1em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale padding'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '1.1em',
    count: 2,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '1.2em',
    count: 4,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '1.25em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '1.35em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '1.4em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale padding'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '1.5em',
    count: 2,
    disposition: 'tracked-debt',
    note: 'content em-scale margin/padding'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '2em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '2.5em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-mermaid.css',
    value: '0.35em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-mermaid.css',
    value: '0.75em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'content em-scale margin'
  },
  {
    file: 'src/web/features/markdown/markdown-workspace.module.css',
    value: '0.3em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'prose heading gap — content em-scale'
  },
  {
    file: 'src/web/features/markdown/markdown-workspace.module.css',
    value: '0.6em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'prose heading gap — content em-scale'
  },
  {
    file: 'src/web/features/markdown/markdown-workspace.module.css',
    value: '0.75em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'prose block gap — content em-scale'
  }
]

/** Values that now have a Mantine spacing token and must never be reintroduced as literals. */
const TOKENIZABLE_PX = new Set(['3px', '4px', '5px', '6px', '8px', '10px', '12px'])

describe('S1 — spacing-class literal gate', () => {
  const cssFiles = collectFiles(WEB_ROOT, '.css')

  it('scans the whole web stylesheet tree', () => {
    expect(cssFiles.length).toBeGreaterThan(20)
    expect(cssFiles.some((file) => file.endsWith('customization.css'))).toBe(true)
  })

  it('is class-aware — only gap/padding/margin and spacing custom properties are scanned', () => {
    const synthetic = [
      '.a { gap: 7px; padding: 7px; margin: 7px; --foo-gap: 7px; }',
      '.b { border-radius: 7px; border: 7px solid red; --foo-radius: 7px; }',
      '.c { --foo-letter-spacing: 7px; letter-spacing: 7px; }'
    ].join('\n')
    const hits = findSpacingLiterals(synthetic, 'synthetic.css')
    expect(hits.map((hit) => hit.value)).toEqual(['7px', '7px', '7px', '7px'])
    expect(hits.every((hit) => hit.prop !== 'border-radius' && hit.prop !== 'border')).toBe(true)
  })

  it('the exemption table is closed — no unrecorded exemption', () => {
    expect(Object.keys(INTRINSIC_EXEMPTIONS).sort()).toEqual(
      ['-1px', '-2px', '0', '0px', '1px', '100%', '2px', 'auto', 'flex', 'none'].sort()
    )
    for (const [value, entry] of Object.entries(INTRINSIC_EXEMPTIONS)) {
      expect(entry.rationale, `rationale for ${value}`).not.toBe('')
    }
  })

  it('the baseline contains no tokenizable px literal', () => {
    const offenders = SPACING_BASELINE.filter((entry) => TOKENIZABLE_PX.has(entry.value))
    expect(offenders.map((entry) => `${entry.file}::${entry.value}`)).toEqual([])
  })

  it('every spacing literal is exempt or in the reviewed baseline', () => {
    const allowed = new Map<string, number>()
    for (const entry of SPACING_BASELINE) {
      const key = `${entry.file}::${entry.value}`
      allowed.set(key, (allowed.get(key) ?? 0) + entry.count)
    }

    const foundByKey = new Map<string, FoundLiteral[]>()
    for (const file of cssFiles) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, '/')
      for (const literal of findSpacingLiterals(readFileSync(file, 'utf8'), rel)) {
        const key = `${literal.file}::${literal.value}`
        const list = foundByKey.get(key) ?? []
        list.push(literal)
        foundByKey.set(key, list)
      }
    }

    const unexpected: string[] = []
    for (const [key, list] of foundByKey) {
      if (Object.hasOwn(INTRINSIC_EXEMPTIONS, list[0]?.value ?? '')) continue
      const permitted = allowed.get(key) ?? 0
      if (list.length > permitted) {
        const lines = list.map((literal) => literal.line).join(', ')
        unexpected.push(`${key} — found ${list.length}, baseline ${permitted} (lines ${lines})`)
      }
    }
    expect(
      unexpected,
      `New spacing literal(s) not in the S1 baseline:\n${unexpected.join('\n')}`
    ).toEqual([])
  })
})
