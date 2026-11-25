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
// Full S1 scope — sizes, radius, motion durations and z-index
// ---------------------------------------------------------------------------

/**
 * The plan's Gate S1 promises five value classes, not just spacing. Each class
 * has its OWN property matcher and literal grammar so a value cannot drift
 * between classes: a `4px` radius is never reviewed as a spacing token, and a
 * `150ms` motion literal is never reviewed as a size. Every class is additive
 * with its own reviewed baseline and disposition, exactly like spacing/C9.
 */
type ValueClass = 'size' | 'radius' | 'motion' | 'z-index'

interface ClassRule {
  name: ValueClass
  property: (prop: string) => boolean
  extract: (raw: string) => string[]
}

const SIZE_PROP =
  /^(?:width|height|min-width|min-height|max-width|max-height|inline-size|block-size|min-inline-size|max-inline-size|min-block-size|max-block-size|flex-basis)$/
const SIZE_CUSTOM = /^--[\w-]*(?:width|height|size)[\w-]*$/
const RADIUS_PROP = /^(?:border-radius|border-(?:top|right|bottom|left)-(?:start|end)-radius)$/
const RADIUS_CUSTOM = /^--[\w-]*radius[\w-]*$/
const MOTION_PROP = /^(?:transition|animation)(?:-(?:duration|delay))?$/
const MOTION_CUSTOM = /^--[\w-]*(?:motion|duration|transition|animation)[\w-]*$/
const ZINDEX_PROP = /^z-index$/
const ZINDEX_CUSTOM = /^--[\w-]*(?:z-index|z-)[\w-]*$/

/**
 * Unit-optional so the same grammar covers CSS lengths and TSX numeric styles.
 * Viewport units are included so `100dvh` is reviewed whole, not misread as a
 * bare `100` (which would silently create a new unbaselined literal).
 */
const LENGTH_OR_NUMBER = /-?\d+(?:\.\d+)?(?:px|rem|em|%|dvh|vh|vw|svh|lvh|dvw|svw|lvw)?/g
const DURATION_LITERAL = /\b\d+(?:\.\d+)?(?:ms|s)\b/g
const INTEGER_LITERAL = /\b\d+\b/g

const CLASS_RULES: readonly ClassRule[] = [
  {
    name: 'size',
    // Unitless line-heights are document typography (intentional-relative),
    // not box sizes — the typography decision owns them, not Gate S1.
    property: (p) => !p.includes('line-height') && (SIZE_PROP.test(p) || SIZE_CUSTOM.test(p)),
    extract: (raw) => [...raw.matchAll(LENGTH_OR_NUMBER)].map((m) => m[0])
  },
  {
    name: 'radius',
    property: (p) => RADIUS_PROP.test(p) || RADIUS_CUSTOM.test(p),
    extract: (raw) => [...raw.matchAll(LENGTH_OR_NUMBER)].map((m) => m[0])
  },
  {
    name: 'motion',
    property: (p) => MOTION_PROP.test(p) || MOTION_CUSTOM.test(p),
    extract: (raw) => [...raw.matchAll(DURATION_LITERAL)].map((m) => m[0])
  },
  {
    name: 'z-index',
    property: (p) => ZINDEX_PROP.test(p) || ZINDEX_CUSTOM.test(p),
    extract: (raw) => [...raw.matchAll(INTEGER_LITERAL)].map((m) => m[0])
  }
]

/** camelCase TSX style keys (borderRadius, zIndex) → kebab-case CSS properties. */
function normalizeProp(prop: string): string {
  return prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

/**
 * Scans CSS declarations and TSX `style={{ ... }}` objects with the same
 * class-aware rule. `calc()` is exempt by the plan (an SSoT var combined with
 * intrinsic values), so it is skipped rather than recorded.
 */
function findClassLiterals(source: string, file: string, rule: ClassRule): FoundLiteral[] {
  const found: FoundLiteral[] = []
  const record = (prop: string, raw: string, line: number): void => {
    if (!rule.property(normalizeProp(prop))) return
    const value = raw.replace(/\s+/g, ' ').trim()
    if (value.includes('calc(')) return
    for (const literal of rule.extract(value)) found.push({ file, line, prop, value: literal })
  }

  if (file.endsWith('.tsx')) {
    for (const block of source.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
      const body = block[1] ?? ''
      const line = source.slice(0, block.index).split('\n').length
      for (const decl of body.matchAll(/([\w-]+)\s*:\s*([^,}\n]+)/g)) {
        record(decl[1] ?? '', decl[2] ?? '', line)
      }
    }
    return found
  }

  const code = stripComments(source)
  for (const decl of code.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
    const line = code.slice(0, decl.index).split('\n').length
    record(decl[1] ?? '', decl[2] ?? '', line)
  }
  return found
}

/** Intrinsic values exempt for the non-spacing classes (plan §Gate S1). */
const CLASS_EXEMPTIONS: Readonly<Record<ValueClass, ReadonlySet<string>>> = {
  size: new Set(['0', '1px', '100%', 'auto', 'none', 'flex']),
  radius: new Set(['0', '1px', '100%', 'auto', 'none']),
  motion: new Set<string>(),
  'z-index': new Set(['0'])
}

// ---------------------------------------------------------------------------
// S1 baseline
// ---------------------------------------------------------------------------

type Disposition = 'allowlist' | 'tracked-debt' | 'intentional-relative'

/**
 * Owner-approved typography decision: document typography ratios are
 * intentionally relative to the parent font size. Converting these em values
 * to fixed px would break heading proportions, nested content and responsive
 * typography. They are reviewed and approved, not debt awaiting tokenization.
 */
const TYPOGRAPHY_RATIONALE =
  'owner-approved typography decision: document ratios stay relative to the parent font size; converting to fixed px would break heading proportions, nested content and responsive typography'

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
 * Entries are `tracked-debt` (a component-specific px with no spacing step),
 * `intentional-relative` (owner-approved document typography em ratios — see
 * TYPOGRAPHY_RATIONALE), or `allowlist` (a calc() that already combines an SSoT
 * var with intrinsic values). The em values stay in the baseline so a NEW em
 * literal still fails; only their disposition is approved.
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

  // Content typography em-scale. Owner-approved as intentional-relative: these
  // ratios must stay proportional to the parent font size (see
  // TYPOGRAPHY_RATIONALE). They remain in the baseline so new em literals fail.
  {
    file: 'src/web/features/markdown/markdown-columns.css',
    value: '0.35em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-columns.css',
    value: '0.5em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-columns.css',
    value: '0.75em',
    count: 2,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '-1.5em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale hanging indent`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.05em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale padding`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.1em',
    count: 3,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale padding`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.2em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale padding`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.22em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.25em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.28em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale padding`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.3em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.34em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale padding`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.35em',
    count: 4,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin/padding`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.4em',
    count: 3,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.45em',
    count: 2,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin/padding`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.5em',
    count: 2,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.55em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '0.9em',
    count: 2,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '1em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale padding`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '1.1em',
    count: 2,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '1.2em',
    count: 4,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '1.25em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '1.35em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '1.4em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale padding`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '1.5em',
    count: 2,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin/padding`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '2em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-content.css',
    value: '2.5em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-mermaid.css',
    value: '0.35em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-mermaid.css',
    value: '0.75em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — content em-scale margin`
  },
  {
    file: 'src/web/features/markdown/markdown-workspace.module.css',
    value: '0.3em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — prose heading gap — content em-scale`
  },
  {
    file: 'src/web/features/markdown/markdown-workspace.module.css',
    value: '0.6em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — prose heading gap — content em-scale`
  },
  {
    file: 'src/web/features/markdown/markdown-workspace.module.css',
    value: '0.75em',
    count: 1,
    disposition: 'intentional-relative',
    note: `${TYPOGRAPHY_RATIONALE} — prose block gap — content em-scale`
  }
]

interface ClassBaselineEntry extends BaselineEntry {
  class: ValueClass
}

/**
 * Reviewed baselines for the four value classes beyond spacing. Generated from
 * the current `src/web` tree and keyed by (class, file, value) with occurrence
 * counts, mirroring the C9/spacing model. `tracked-debt` entries are accepted
 * today but have no shared token; `allowlist` entries are documented intrinsic
 * or platform-specific exemptions. New literals outside these baselines fail.
 */
const CLASS_BASELINE: readonly ClassBaselineEntry[] = [
  // size: 56 entries
  {
    class: 'size',
    file: 'src/web/components/window-chrome.module.css',
    value: '10px',
    count: 7,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/components/window-chrome.module.css',
    value: '46px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/components/window-chrome.module.css',
    value: '7px',
    count: 2,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/calendar/calendar.module.css',
    value: '220px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/dashboard/dashboard.module.css',
    value: '300px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/dashboard/page-card.module.css',
    value: '210px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/dashboard/page-card.module.css',
    value: '22px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/html-editor/source-find-dialog.module.css',
    value: '340px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/markdown/markdown-columns.css',
    value: '0.85em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/markdown/markdown-workspace.module.css',
    value: '0.9em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/markdown/markdown-workspace.module.css',
    value: '3px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/pages/page-workspace.module.css',
    value: '18px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/pages/page-workspace.module.css',
    value: '28px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/pages/page-workspace.module.css',
    value: '760px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/rich-editor/blocks/diagram-template-bar.module.css',
    value: '1.2em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/rich-editor/blocks/diagram-template-bar.module.css',
    value: '24px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/rich-editor/blocks/diagram-view.module.css',
    value: '140px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/rich-editor/blocks/diagram-view.module.css',
    value: '15px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/rich-editor/blocks/diagram-view.module.css',
    value: '18px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/rich-editor/blocks/diagram-view.module.css',
    value: '26px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/rich-editor/blocks/diagram-view.module.css',
    value: '32px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/rich-editor/blocks/document-block.module.css',
    value: '28px',
    count: 2,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/rich-editor/blocks/linked-page.module.css',
    value: '28px',
    count: 2,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/rich-editor/blocks/linked-page.module.css',
    value: '360px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/rich-editor/blocks/mermaid-block.module.css',
    value: '18px',
    count: 2,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/rich-editor/rich-editor.module.css',
    value: '280px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/settings/debug-log-viewer.module.css',
    value: '220px',
    count: 2,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/settings/debug-log-viewer.module.css',
    value: '90px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/settings/settings.module.css',
    value: '200px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/settings/settings.module.css',
    value: '30px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/settings/settings.module.css',
    value: '3px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/settings/settings.module.css',
    value: '640px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/shortcuts/shortcut-help.module.css',
    value: '40%',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/sidebar/page-tree.module.css',
    value: '20px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/visual-pages/mermaid-workspace.module.css',
    value: '18px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/visual-pages/mermaid-workspace.module.css',
    value: '22px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/workspace/document-toolbar.module.css',
    value: '20px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/workspace/document-toolbar.module.css',
    value: '28px',
    count: 2,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/workspace/right-sidebar.module.css',
    value: '260px',
    count: 2,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/features/workspace/status-bar.module.css',
    value: '28px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/layout/sidebar.module.css',
    value: '20px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/layout/app-shell.module.css',
    value: '100dvh',
    count: 1,
    disposition: 'allowlist',
    note: 'viewport-fill unit — layout-mechanical, no SSoT token equivalent'
  },
  {
    class: 'size',
    file: 'src/web/features/workspace/status-bar.module.css',
    value: '50vh',
    count: 1,
    disposition: 'allowlist',
    note: 'viewport-relative cap — layout-mechanical, no SSoT token equivalent'
  },
  {
    class: 'size',
    file: 'src/web/theme/customization.css',
    value: '0.9em',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/theme/customization.css',
    value: '12.5px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/theme/customization.css',
    value: '13px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/theme/customization.css',
    value: '14px',
    count: 3,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/theme/customization.css',
    value: '18px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/theme/customization.css',
    value: '22px',
    count: 2,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/theme/customization.css',
    value: '28px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/theme/customization.css',
    value: '2px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/theme/customization.css',
    value: '300px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/theme/customization.css',
    value: '30px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/theme/customization.css',
    value: '320px',
    count: 2,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/theme/customization.css',
    value: '32px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/theme/customization.css',
    value: '3px',
    count: 2,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/theme/customization.css',
    value: '40px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'size',
    file: 'src/web/theme/customization.css',
    value: '72px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'size literal with no shared token; accepted in the reviewed baseline'
  },

  // radius: 3 entries
  {
    class: 'radius',
    file: 'src/web/theme/customization.css',
    value: '3px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'radius literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'radius',
    file: 'src/web/theme/customization.css',
    value: '50%',
    count: 1,
    disposition: 'tracked-debt',
    note: 'radius literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'radius',
    file: 'src/web/theme/customization.css',
    value: '6px',
    count: 1,
    disposition: 'tracked-debt',
    note: 'radius literal with no shared token; accepted in the reviewed baseline'
  },

  // motion: 4 entries
  {
    class: 'motion',
    file: 'src/web/components/window-chrome.module.css',
    value: '75ms',
    count: 2,
    disposition: 'allowlist',
    note: 'platform-specific caption-button feedback; documented motion exemption'
  },
  {
    class: 'motion',
    file: 'src/web/features/markdown/markdown-content.css',
    value: '120ms',
    count: 1,
    disposition: 'allowlist',
    note: 'document typography link underline; approved typography exemption'
  },
  {
    class: 'motion',
    file: 'src/web/theme/customization.css',
    value: '0ms',
    count: 5,
    disposition: 'allowlist',
    note: 'reduced-motion render-time override of the five --rtwiki-motion-* tokens'
  },
  {
    class: 'motion',
    file: 'src/web/theme/customization.css',
    value: '80ms',
    count: 1,
    disposition: 'allowlist',
    note: 'tree-specific quick expander feedback; single-use, owner decision 3'
  },

  // z-index: 7 entries
  {
    class: 'z-index',
    file: 'src/web/components/window-chrome.module.css',
    value: '1',
    count: 2,
    disposition: 'tracked-debt',
    note: 'z-index literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'z-index',
    file: 'src/web/components/window-chrome.module.css',
    value: '2',
    count: 1,
    disposition: 'tracked-debt',
    note: 'z-index literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'z-index',
    file: 'src/web/features/dashboard/page-card.module.css',
    value: '2',
    count: 1,
    disposition: 'tracked-debt',
    note: 'z-index literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'z-index',
    file: 'src/web/features/html-editor/source-find-dialog.module.css',
    value: '6',
    count: 1,
    disposition: 'tracked-debt',
    note: 'z-index literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'z-index',
    file: 'src/web/features/markdown/markdown-content.css',
    value: '1',
    count: 1,
    disposition: 'tracked-debt',
    note: 'z-index literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'z-index',
    file: 'src/web/features/rich-editor/blocks/mermaid-block.module.css',
    value: '3',
    count: 1,
    disposition: 'tracked-debt',
    note: 'z-index literal with no shared token; accepted in the reviewed baseline'
  },
  {
    class: 'z-index',
    file: 'src/web/features/rich-editor/blocks/mermaid-block.module.css',
    value: '5',
    count: 1,
    disposition: 'tracked-debt',
    note: 'z-index literal with no shared token; accepted in the reviewed baseline'
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

  /**
   * Classification drift guard. The owner approved the em-scale typography
   * values as `intentional-relative`, not debt. This asserts the disposition
   * cannot silently drift back: relative entries must be em (or unitless), and
   * no tracked-debt entry may be an em value.
   */
  it('intentional-relative entries are em/unitless and tracked-debt entries are never em', () => {
    const relative = SPACING_BASELINE.filter(
      (entry) => entry.disposition === 'intentional-relative'
    )
    expect(relative.length, 'the approved typography entries must stay in the baseline').toBe(32)
    for (const entry of relative) {
      const isEm = /^-?\d+(?:\.\d+)?em$/.test(entry.value)
      const isUnitless = /^\d+(?:\.\d+)?$/.test(entry.value)
      expect(
        isEm || isUnitless,
        `${entry.file}::${entry.value} must be em or unitless, not px`
      ).toBe(true)
      expect(entry.note, `${entry.file}::${entry.value} rationale`).toContain(TYPOGRAPHY_RATIONALE)
    }

    const debt = SPACING_BASELINE.filter((entry) => entry.disposition === 'tracked-debt')
    expect(debt.length, 'px debt entries must stay in the baseline').toBeGreaterThan(0)
    for (const entry of debt) {
      expect(
        entry.value.includes('em'),
        `${entry.file}::${entry.value} is an em value and must be intentional-relative`
      ).toBe(false)
    }
  })

  /**
   * Evidence for the owner-approved document typography decision. The S1
   * baseline guards em literals generically; this assertion names the exact
   * heading ratio scale so a silent edit to a heading proportion fails loudly
   * instead of merely being re-baselined. Source: markdown-content.css:122-155.
   */
  it('document heading ratio scale is present and unchanged', () => {
    const css = readFileSync(join(WEB_ROOT, 'features', 'markdown', 'markdown-content.css'), 'utf8')
    const expected: ReadonlyArray<readonly [string, string]> = [
      ['h1', '1.85em'],
      ['h2', '1.45em'],
      ['h3', '1.2em'],
      ['h4', '1.05em'],
      ['h5', '0.95em'],
      ['h6', '0.95em']
    ]
    for (const [heading, ratio] of expected) {
      const selector = `[data-rt-markdown-preview] ${heading}`
      // The same selector can appear in a grouped base rule (font-weight etc.)
      // before the ratio rule, and in a narrow-layout override after it. Walk
      // occurrences and assert the FIRST rule that actually declares font-size
      // — that is the primary document ratio scale.
      let cursor = css.indexOf(selector)
      let block = ''
      while (cursor !== -1) {
        block = css.slice(cursor, css.indexOf('}', cursor))
        if (block.includes('font-size:')) break
        cursor = css.indexOf(selector, cursor + selector.length)
      }
      expect(cursor, `${selector} rule with font-size must exist`).toBeGreaterThan(-1)
      expect(
        block.includes(`font-size: ${ratio}`),
        `${selector} must keep font-size ${ratio}`
      ).toBe(true)
    }
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

  // -------------------------------------------------------------------------
  // Full S1 scope — all five value classes
  // -------------------------------------------------------------------------

  /** The shared fail-on-new-literal check, exercised by both real and synthetic scans. */
  function unexpectedForClass(cls: ValueClass, found: FoundLiteral[]): string[] {
    const allowed = new Map<string, number>()
    for (const entry of CLASS_BASELINE) {
      if (entry.class !== cls) continue
      const key = `${entry.file}::${entry.value}`
      allowed.set(key, (allowed.get(key) ?? 0) + entry.count)
    }
    const exempt = CLASS_EXEMPTIONS[cls]
    const byKey = new Map<string, FoundLiteral[]>()
    for (const literal of found) {
      const key = `${literal.file}::${literal.value}`
      const list = byKey.get(key) ?? []
      list.push(literal)
      byKey.set(key, list)
    }
    const unexpected: string[] = []
    for (const [key, list] of byKey) {
      if (exempt.has(list[0]?.value ?? '')) continue
      const permitted = allowed.get(key) ?? 0
      if (list.length > permitted) {
        unexpected.push(`${cls} ${key} — found ${list.length}, baseline ${permitted}`)
      }
    }
    return unexpected
  }

  it('covers all five promised value classes with class-aware scanners', () => {
    const synthetic = [
      '.a { width: 41px; padding: 41px; border-radius: 41px; transition-duration: 41ms; z-index: 41; }'
    ].join('\n')
    const byClass = new Map<ValueClass, string[]>()
    for (const rule of CLASS_RULES) {
      byClass.set(
        rule.name,
        findClassLiterals(synthetic, 'synthetic.css', rule).map((hit) => hit.value)
      )
    }
    // The same numeric value in four different property classes is claimed by
    // exactly one class each — no cross-class false pass.
    expect(byClass.get('size')).toEqual(['41px'])
    expect(byClass.get('radius')).toEqual(['41px'])
    expect(byClass.get('motion')).toEqual(['41ms'])
    expect(byClass.get('z-index')).toEqual(['41'])
    expect(findSpacingLiterals(synthetic, 'synthetic.css').map((hit) => hit.value)).toEqual([
      '41px'
    ])
  })

  it('scans TSX style objects with the same class rules', () => {
    const synthetic = 'const x = <div style={{ width: 999, borderRadius: 999, zIndex: 999 }} />'
    for (const [cls, expected] of [
      ['size', '999'],
      ['radius', '999'],
      ['z-index', '999']
    ] as const) {
      const rule = CLASS_RULES.find((candidate) => candidate.name === cls)
      expect(rule, `${cls} rule must exist`).toBeDefined()
      if (!rule) continue
      expect(findClassLiterals(synthetic, 'synthetic.tsx', rule).map((hit) => hit.value)).toEqual([
        expected
      ])
    }
  })

  it('a new literal in each value class fails the gate', () => {
    const samples: Readonly<Record<ValueClass, string>> = {
      size: 'width: 999px',
      radius: 'border-radius: 999px',
      motion: 'transition-duration: 999ms',
      'z-index': 'z-index: 999'
    }
    for (const rule of CLASS_RULES) {
      const found = findClassLiterals(
        `.new { ${samples[rule.name]}; }`,
        'src/web/theme/customization.css',
        rule
      )
      expect(found.length, `${rule.name} scanner must find the new literal`).toBeGreaterThan(0)
      expect(
        unexpectedForClass(rule.name, found),
        `${rule.name}: a new literal must fail the gate`
      ).not.toEqual([])
    }
  })

  it('every class baseline entry has a valid disposition and rationale', () => {
    expect(CLASS_BASELINE.length).toBeGreaterThan(0)
    for (const entry of CLASS_BASELINE) {
      expect(['allowlist', 'tracked-debt']).toContain(entry.disposition)
      expect(entry.note.length, `${entry.class} ${entry.value} rationale`).toBeGreaterThan(0)
      expect(entry.count).toBeGreaterThan(0)
      expect(
        CLASS_RULES.some((rule) => rule.name === entry.class),
        entry.class
      ).toBe(true)
    }
  })

  it('every non-spacing literal is exempt or in the reviewed class baseline', () => {
    const files = [...cssFiles, ...collectFiles(WEB_ROOT, '.tsx')]
    const unexpected: string[] = []
    for (const rule of CLASS_RULES) {
      const found: FoundLiteral[] = []
      for (const file of files) {
        const rel = relative(REPO_ROOT, file).replace(/\\/g, '/')
        found.push(...findClassLiterals(readFileSync(file, 'utf8'), rel, rule))
      }
      unexpected.push(...unexpectedForClass(rule.name, found))
    }
    expect(
      unexpected,
      `New literal(s) outside the S1 class baselines:\n${unexpected.join('\n')}`
    ).toEqual([])
  })
})
