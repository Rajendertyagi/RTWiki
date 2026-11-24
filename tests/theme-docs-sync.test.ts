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

  it('registers all seven waivers with all seven required fields', () => {
    const rows = waiverRows()
    for (let n = 1; n <= 7; n += 1) {
      const id = `W-${String(n).padStart(3, '0')}`
      const cells = rows.get(id)
      expect(cells, `${id} must be a row in docs/theme-waivers.md`).toBeDefined()
      expect(cells?.length, `${id} must have 7 fields`).toBe(7)
      for (const [index, cell] of (cells ?? []).entries()) {
        expect(cell.length, `${id} field ${index + 1} must be non-empty`).toBeGreaterThan(0)
      }
      expect(cells?.[4], `${id} date must be 2026-11-24`).toContain('2026-11-24')
    }
  })

  it('W-003 references the C9 baseline dispositions', () => {
    const row = waiverRows().get('W-003')?.join(' ') ?? ''
    expect(row).toContain('theme-consumers.test.ts')
    expect(row.toLowerCase()).toContain('tracked-debt')
  })

  it('W-007 records the dropped Mantine style-tag CSP nonce gate', () => {
    const row = waiverRows().get('W-007')?.join(' ') ?? ''
    expect(row).toContain('D5')
    expect(row).toContain('unsafe-inline')
    expect(row.toLowerCase()).toContain('nonce')
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
})
