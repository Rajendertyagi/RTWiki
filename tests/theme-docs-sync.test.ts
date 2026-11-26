import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Docs-sync guard for the theme coverage plan (Stage 6).
 *
 * Fast, browser-free: reads the coverage doc, the waiver registry and the theme
 * JSON files from disk and asserts they have not drifted apart. Link validity
 * and heading anchors are checked separately by `bun scripts/verify-docs.ts`.
 */

const REPO_ROOT = join(import.meta.dir, '..')
const COVERAGE_PATH = join(REPO_ROOT, 'docs', 'THEME_COVERAGE.md')
const WAIVERS_PATH = join(REPO_ROOT, 'docs', 'theme-waivers.md')
const THEMES_DIR = join(REPO_ROOT, 'src', 'web', 'themes')

const coverage = readFileSync(COVERAGE_PATH, 'utf8')
const waivers = readFileSync(WAIVERS_PATH, 'utf8')

/** Theme ids declared by the JSON files on disk. */
function themeIdsFromDisk(): string[] {
  return readdirSync(THEMES_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const parsed = JSON.parse(readFileSync(join(THEMES_DIR, name), 'utf8')) as {
        id?: unknown
      }
      return typeof parsed.id === 'string' ? parsed.id : null
    })
    .filter((id): id is string => id !== null)
    .sort()
}

/** Local Markdown targets linked from a document (fragments/queries stripped). */
function linkedMarkdownDocs(source: string): string[] {
  const docs: string[] = []
  for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0].split('?')[0]
    if (target.endsWith('.md')) docs.push(target)
  }
  return docs
}

/** Coverage doc plus the local docs it links to, as one searchable string. */
function searchableDocs(): string {
  let text = coverage
  for (const target of linkedMarkdownDocs(coverage)) {
    // join() normalises '../AGENTS.md' relative to docs/ back to the repo root.
    const abs = join(REPO_ROOT, 'docs', target)
    if (existsSync(abs)) text += `\n${readFileSync(abs, 'utf8')}`
  }
  return text
}

/** Waiver table rows keyed by ID, each as its seven trimmed cell values. */
function waiverRows(): Map<string, string[]> {
  const rows = new Map<string, string[]>()
  for (const line of waivers.split(/\r?\n/)) {
    const match = /^\|\s*(W-\d{3})\s*\|/.exec(line)
    if (!match) continue
    rows.set(
      match[1],
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
    )
  }
  return rows
}

describe('theme docs sync', () => {
  it('every theme JSON id is mentioned in the coverage doc or a linked doc', () => {
    const text = searchableDocs()
    const ids = themeIdsFromDisk()
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(
        text.includes(id),
        `theme id "${id}" must be mentioned in THEME_COVERAGE.md or a linked doc`
      ).toBe(true)
    }
  })

  // W-003 was removed after its dialog shadow became a semantic theme token,
  // so the remaining ids are deliberately non-contiguous.
  const EXPECTED_WAIVERS = [
    'W-001',
    'W-002',
    'W-004',
    'W-005',
    'W-006',
    'W-007',
    'W-008',
    'W-009',
    'W-010',
    'W-011',
    'W-012',
    'W-013'
  ] as const

  it('registers all twelve waivers with all seven required fields', () => {
    const rows = waiverRows()
    for (const id of EXPECTED_WAIVERS) {
      const cells = rows.get(id)
      expect(cells, `${id} must be a row in docs/theme-waivers.md`).toBeDefined()
      expect(cells?.length, `${id} must have 7 fields`).toBe(7)
      for (const [index, cell] of (cells ?? []).entries()) {
        expect(cell.length, `${id} field ${index + 1} must be non-empty`).toBeGreaterThan(0)
      }
      // W-013 was added on 2026-11-25; the original twelve are dated 2026-11-24.
      expect(cells?.[4], `${id} must carry its expected date`).toContain(
        id === 'W-013' ? '2026-11-25' : '2026-11-24'
      )
    }
    expect(rows.size, 'no waiver beyond the twelve expected ids').toBe(EXPECTED_WAIVERS.length)
    expect(rows.has('W-003'), 'W-003 must be removed, not narrowed').toBe(false)
  })

  it('registers the typography, motion and status exceptions reconciled in Phase 4b', () => {
    const row = (id: string): string => waiverRows().get(id)?.join(' ') ?? ''
    expect(row('W-008').toLowerCase(), 'document typography relative').toContain('intentional')
    expect(row('W-008')).toContain('em')
    expect(row('W-009')).toContain('75ms')
    expect(row('W-010')).toContain('120ms')
    expect(row('W-011')).toContain('80ms')
    expect(row('W-012').toLowerCase(), 'status fixed decision').toContain('decision')
  })

  it('W-007 records the dropped Mantine style-tag CSP nonce gate', () => {
    const row = waiverRows().get('W-007')?.join(' ') ?? ''
    expect(row).toContain('D5')
    expect(row).toContain('unsafe-inline')
    expect(row.toLowerCase()).toContain('nonce')
  })

  it('W-013 waives the Windows caption close-button colours in the C9 baseline', () => {
    const row = waiverRows().get('W-013')?.join(' ') ?? ''
    expect(row, 'W-013 must target the C9 colour baseline').toContain('C9')
    expect(row, 'W-013 must name the close hover colour').toContain('#e81123')
    expect(row, 'W-013 must name the close glyph colour').toContain('#fff')
    expect(row, 'W-013 must name the close active colour').toContain('#c50f1f')
    expect(row.toLowerCase(), 'W-013 must give a platform-convention rationale').toContain(
      'platform convention'
    )
    expect(row, 'W-013 must point at the C9 baseline dispositions').toContain(
      'theme-consumers.test.ts'
    )
    expect(row.toLowerCase(), 'W-013 must state the allowlist disposition').toContain('allowlist')
    expect(row, 'W-013 must carry the 2026-11-25 date').toContain('2026-11-25')
  })

  it('the four theme ids and three risky Mantine keys appear in the coverage doc', () => {
    for (const id of ['default', 'pastel-dreams', 'catppuccin', 'vercel']) {
      expect(coverage.includes(id), `coverage doc must mention theme "${id}"`).toBe(true)
    }
    for (const key of [
      '--mantine-color-default',
      '--mantine-color-disabled',
      '--mantine-color-disabled-border'
    ]) {
      expect(coverage.includes(key), `coverage doc must mention "${key}"`).toBe(true)
    }
  })

  it('documents the owner-approved heading ratio scale (plan decision 8)', () => {
    for (const ratio of ['1.85', '1.45', '1.2', '1.05', '0.95', '1.55', '1.3']) {
      expect(coverage.includes(ratio), `heading ratio ${ratio} must be documented`).toBe(true)
    }
    expect(coverage, 'Mantine must own the preview base size').toContain('--mantine-font-size-sm')
    expect(coverage, 'RTWiki must own the document ratio scale').toContain('RTWiki owns')
  })

  it('documents the reconciled S1, A6 and reduced-motion status with evidence', () => {
    for (const cls of ['sizes', 'spacing', 'radius', 'motion durations', 'z-index']) {
      expect(coverage.includes(cls), `S1 must document the "${cls}" value class`).toBe(true)
    }
    expect(coverage, 'S1 must cover TSX style objects').toContain('TSX')
    expect(coverage, 'A6 must document the real API/DB path').toContain('SQLite')
    expect(coverage, 'A6 must document last-write-wins').toContain('last-write-wins')
    expect(coverage, 'reduced motion must be a computed-style check').toContain('computed-style')
    expect(coverage, 'reduced motion must name the RTWiki-owned transition override').toContain(
      'prefers-reduced-motion: reduce'
    )
  })
})
