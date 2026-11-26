import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Phase 2 source-level consumer gates for the theme coverage plan.
 *
 * Every check here is static: it reads source text from disk and asserts on it.
 * No browser, server, network, or computed-style work happens in this file —
 * that verification is deferred to a later consolidated phase.
 *
 * The gates are deliberately *additive*: they block NEW literal colours and
 * NEW drift in third-party/pseudo-surface wiring. They do not require the
 * tracked-debt literals to be tokenized yet; that is separate work.
 */

const REPO_ROOT = join(import.meta.dir, '..')
const WEB_ROOT = join(REPO_ROOT, 'src', 'web')

function webPath(rel: string): string {
  return join(WEB_ROOT, rel)
}

function readWeb(rel: string): string {
  return readFileSync(webPath(rel), 'utf8')
}

/** Recursively collect files with the given extension under a directory. */
function collectFiles(dir: string, ext: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collectFiles(full, ext, out)
    else if (full.endsWith(ext)) out.push(full)
  }
  return out
}

/**
 * Blank out block comments and `//` line comments while preserving newlines,
 * so 1-based line numbers in the reported findings stay accurate. A small
 * stateful scanner skips quoted strings, so a `//` inside a URL such as
 * `https://example.com` is never mistaken for a comment (R1-L1).
 */
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

/**
 * CSS named colours that are *not* theme references. The negative lookarounds
 * keep token names such as `--mantine-color-red-6` and
 * `--bn-colors-text-color-red` from being mistaken for literals.
 */
const NAMED_COLOURS = [
  'white',
  'black',
  'red',
  'blue',
  'green',
  'yellow',
  'orange',
  'purple',
  'pink',
  'gray',
  'grey',
  'brown',
  'teal',
  'violet',
  'cyan',
  'magenta',
  'lime',
  'navy',
  'olive',
  'maroon',
  'silver',
  'gold',
  'coral',
  'crimson',
  'indigo',
  'khaki',
  'lavender',
  'orchid',
  'salmon',
  'tan',
  'tomato',
  'turquoise',
  'wheat'
] as const

const COLOUR_LITERAL_RE = new RegExp(
  [
    '#[0-9a-fA-F]{3,8}\\b',
    'rgba?\\([^)]*\\)',
    'oklch\\([^)]*\\)',
    'hsla?\\([^)]*\\)',
    `(?<![-\\w])(?:${NAMED_COLOURS.join('|')})(?![-\\w])`
  ].join('|'),
  'g'
)

interface FoundLiteral {
  file: string
  line: number
  value: string
}

function findLiterals(files: string[]): FoundLiteral[] {
  const found: FoundLiteral[] = []
  for (const absolute of files) {
    const file = relative(REPO_ROOT, absolute).replace(/\\/g, '/')
    const code = stripComments(readFileSync(absolute, 'utf8'))
    code.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(COLOUR_LITERAL_RE)) {
        found.push({ file, line: index + 1, value: match[0] })
      }
    })
  }
  return found
}

describe('source scanning helpers', () => {
  it('strips // line comments but preserves URLs and real values (R1-L1 regression)', () => {
    const synthetic = [
      'const url = "https://example.com/path"',
      '// #ff0000 appears only in this prose comment',
      'const colour = "#00ff00"'
    ].join('\n')
    const stripped = stripComments(synthetic)
    expect(stripped).not.toContain('#ff0000')
    expect(stripped).toContain('https://example.com/path')
    expect(stripped).toContain('#00ff00')
    expect(stripped.split('\n')).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// Gate C9 — literal CSS colours
// ---------------------------------------------------------------------------

type Disposition = 'allowlist' | 'tracked-debt'

interface BaselineEntry {
  file: string
  line: number
  value: string
  disposition: Disposition
  note: string
}

/**
 * Every colour literal currently present in `src/web/**\/*.css` and
 * `src/web/theme/mantine-base.ts`, with a disposition.
 *
 * - `allowlist` — intentionally fixed (Windows caption colours, fixed shadows).
 * - `tracked-debt` — should be tokenized later; the gate still permits it today.
 *
 * Matching is by (file, value) with an occurrence count, NOT by line number:
 * line numbers are recorded for human review only, so moving a declaration
 * does not create a false failure. Adding a new value, or a new occurrence of
 * an existing value, does. Removing a literal (tokenization work) is fine.
 */
const C9_BASELINE: readonly BaselineEntry[] = [
  {
    file: 'src/web/components/window-chrome.module.css',
    line: 105,
    value: '#e81123',
    disposition: 'allowlist',
    note: 'Windows caption close hover — OS-defined colour'
  },
  {
    file: 'src/web/components/window-chrome.module.css',
    line: 106,
    value: '#fff',
    disposition: 'allowlist',
    note: 'Windows caption close glyph — OS-defined colour'
  },
  {
    file: 'src/web/components/window-chrome.module.css',
    line: 110,
    value: '#c50f1f',
    disposition: 'allowlist',
    note: 'Windows caption close active — OS-defined colour'
  },
  {
    file: 'src/web/theme/mantine-base.ts',
    line: 19,
    value: 'rgba(0,0,0,0.05)',
    disposition: 'allowlist',
    note: 'fixed Mantine xs shadow'
  },
  {
    file: 'src/web/theme/mantine-base.ts',
    line: 20,
    value: 'rgba(0,0,0,0.08)',
    disposition: 'allowlist',
    note: 'fixed Mantine sm shadow'
  },
  {
    file: 'src/web/theme/mantine-base.ts',
    line: 21,
    value: 'rgba(0,0,0,0.12)',
    disposition: 'allowlist',
    note: 'fixed Mantine md shadow'
  }
]

describe('C9 — literal CSS colours', () => {
  const cssFiles = collectFiles(WEB_ROOT, '.css')
  const scanned = [...cssFiles, webPath('theme/mantine-base.ts')]

  it('scans the whole web stylesheet tree', () => {
    // Guards against a broken recursive walk silently narrowing the gate.
    expect(cssFiles.length).toBeGreaterThan(20)
    expect(cssFiles.some((file) => file.endsWith('customization.css'))).toBe(true)
  })

  it('every literal colour is in the reviewed baseline', () => {
    const allowed = new Map<string, number>()
    for (const entry of C9_BASELINE) {
      const key = `${entry.file}::${entry.value}`
      allowed.set(key, (allowed.get(key) ?? 0) + 1)
    }

    const foundByKey = new Map<string, FoundLiteral[]>()
    for (const literal of findLiterals(scanned)) {
      const key = `${literal.file}::${literal.value}`
      const list = foundByKey.get(key) ?? []
      list.push(literal)
      foundByKey.set(key, list)
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
      `New colour literal(s) not in the C9 baseline:\n${unexpected.join('\n')}`
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Gate C5 — TSX inline styles / style props
// ---------------------------------------------------------------------------

/** Non-colour keywords that are valid in colour-valued CSS/SVG positions. */
const ALLOWED_KEYWORDS = new Set(['currentColor', 'transparent', 'inherit', 'none'])

/**
 * Semantic colour names used by Mantine props and BlockNote presets. These are
 * theme references (resolved to CSS variables), not CSS colour literals, so
 * they are the sanctioned pattern — e.g. `trash-view.tsx:101` uses
 * `color="var(--mantine-color-gray-6)"`. Any NEW named colour outside this set
 * is treated as a literal and fails the gate.
 */
const SEMANTIC_COLOUR_NAMES = new Set([
  'blue',
  'brown',
  'cyan',
  'gray',
  'green',
  'orange',
  'pink',
  'purple',
  'red',
  'teal',
  'violet',
  'white',
  'yellow'
])

describe('C5 — TSX inline styles / style props', () => {
  const tsxFiles = collectFiles(WEB_ROOT, '.tsx')

  // C9 baseline values are intentionally fixed *in CSS*, not a global
  // allowance. Allowing one here just because it exists in a stylesheet would
  // let a new literal through the gate (R2-D1). Verified: no current TSX file
  // uses any of the 6 baseline values.
  function isAllowed(value: string): boolean {
    return (
      ALLOWED_KEYWORDS.has(value) || SEMANTIC_COLOUR_NAMES.has(value) || value.startsWith('var(--')
    )
  }

  function isAllowedInStyleObject(value: string): boolean {
    // A named colour in a style object is a CSS literal even when the same
    // word is a valid semantic name on a Mantine prop.
    return ALLOWED_KEYWORDS.has(value) || value.startsWith('var(--')
  }

  it('scans the whole web TSX tree', () => {
    expect(tsxFiles.length).toBeGreaterThan(20)
  })

  it('rejects every C9 baseline literal in TSX (R2-D1 regression)', () => {
    for (const entry of C9_BASELINE) {
      expect(isAllowed(entry.value), `isAllowed(${entry.value})`).toBe(false)
      expect(isAllowedInStyleObject(entry.value), `style object ${entry.value}`).toBe(false)
    }
  })

  it('introduces no new literal colour in TSX', () => {
    const offenders = findLiterals(tsxFiles).filter((literal) => !isAllowed(literal.value))
    const details = offenders.map((literal) => `${literal.file}:${literal.line} ${literal.value}`)
    expect(details, `New literal colour(s) in TSX:\n${details.join('\n')}`).toEqual([])
  })

  it('keeps style={{...}} objects free of colour literals', () => {
    const offenders: string[] = []
    for (const file of tsxFiles) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, '/')
      const code = stripComments(readFileSync(file, 'utf8'))
      for (const block of code.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
        const body = block[1] ?? ''
        for (const match of body.matchAll(COLOUR_LITERAL_RE)) {
          if (!isAllowedInStyleObject(match[0])) {
            offenders.push(`${rel}: ${match[0]}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Gate C6 — JS-generated style objects (CodeMirror)
// ---------------------------------------------------------------------------

describe('C6 — JS-generated style objects (CodeMirror)', () => {
  it('builds chrome from theme vars and color-mix(), with no literal colours', () => {
    const source = readWeb('features/html-editor/editor-theme.ts')
    expect(source).toContain('var(--mantine-color-')
    expect(source).toContain('color-mix(')
    expect(findLiterals([webPath('features/html-editor/editor-theme.ts')])).toEqual([])
  })

  it('is scheme-aware — light and dark token variants are present', () => {
    const tokens = readWeb('features/html-editor/code-editor.module.css')
    expect(tokens).toContain('[data-mantine-color-scheme="dark"]')
    expect(tokens).toContain('var(--mantine-color-')
  })
})

// ---------------------------------------------------------------------------
// Gate C7 — SVG presentation attributes
// ---------------------------------------------------------------------------

describe('C7 — SVG presentation attributes', () => {
  const files = [
    'features/rich-editor/blocks/diagram-view.tsx',
    'features/rich-editor/blocks/block-resize.tsx'
  ]

  for (const rel of files) {
    it(`${rel} uses currentColor / theme vars, not literal colours`, () => {
      const source = readWeb(rel)
      expect(findLiterals([webPath(rel)])).toEqual([])

      const colourAttributes = [...source.matchAll(/\b(fill|stroke|color)="([^"]*)"/g)].map(
        (match) => match[2] ?? ''
      )
      for (const value of colourAttributes) {
        const themeDriven =
          value === 'currentColor' || value === 'none' || value.startsWith('var(--')
        expect(themeDriven, `${rel}: unexpected SVG colour attribute "${value}"`).toBe(true)
      }
    })
  }
})

// ---------------------------------------------------------------------------
// Gate C8 — third-party surface classification
// ---------------------------------------------------------------------------

interface ThirdPartySurface {
  name: string
  file: string
  disposition: 'bridged-to-theme' | 'scheme-aware' | 'accepted-static' | 'scheme-matched'
  pattern: readonly string[]
  forbidden?: readonly string[]
  note: string
}

const THIRD_PARTY_SURFACES: readonly ThirdPartySurface[] = [
  {
    name: 'BlockNote swatch panel',
    file: 'features/workspace/swatch-panel.tsx',
    disposition: 'bridged-to-theme',
    pattern: ['--bn-colors-', 'var(--mantine-color-'],
    note: 'swatch paint bridged from BlockNote vars to Mantine tokens (swatch-panel.tsx:136)'
  },
  {
    name: 'Wunderbaum page tree',
    file: 'features/sidebar/page-tree.module.css',
    disposition: 'bridged-to-theme',
    pattern: ['--wb-', 'var(--rtwiki-', 'var(--mantine-color-'],
    note: 'Wunderbaum --wb-* vars bridged to RTWiki/Mantine tokens (page-tree.module.css:70-127)'
  },
  {
    name: 'CodeMirror chrome theme',
    file: 'features/html-editor/editor-theme.ts',
    disposition: 'scheme-aware',
    pattern: ['var(--mantine-color-', 'color-mix('],
    note: 'chrome built on Mantine vars; token colours live in code-editor.module.css'
  },
  {
    name: 'CodeMirror token colours',
    file: 'features/html-editor/code-editor.module.css',
    disposition: 'scheme-aware',
    pattern: ['[data-mantine-color-scheme="dark"]', 'var(--mantine-color-'],
    note: 'light/dark syntax token variants'
  },
  {
    name: 'KaTeX stylesheet',
    file: 'main.tsx',
    disposition: 'accepted-static',
    pattern: ['katex/dist/katex.min.css'],
    note: 'static third-party stylesheet, accepted as-is (main.tsx:46)'
  },
  {
    name: 'Mermaid renderer',
    file: 'features/rich-editor/blocks/mermaid-render.ts',
    disposition: 'scheme-matched',
    pattern: ["type MermaidTheme = 'default' | 'dark'", '...MERMAID_CONFIG, theme }'],
    forbidden: ['var(--'],
    note: 'scheme-matched default/dark; theme-following DEFERRED (Decision 2)'
  },
  {
    name: 'Mantine dates / notifications / schedule',
    file: 'main.tsx',
    disposition: 'bridged-to-theme',
    pattern: [
      '@mantine/dates/styles.css',
      '@mantine/notifications/styles.css',
      '@mantine/schedule/styles.css'
    ],
    note: 'Mantine stylesheets bridged to theme (main.tsx:5-8)'
  }
]

describe('C8 — third-party surface classification', () => {
  for (const surface of THIRD_PARTY_SURFACES) {
    it(`${surface.name} — ${surface.disposition}`, () => {
      const path = webPath(surface.file)
      expect(existsSync(path), `${surface.file} must still exist`).toBe(true)
      const source = readFileSync(path, 'utf8')
      for (const token of surface.pattern) {
        expect(source).toContain(token)
      }
      for (const token of surface.forbidden ?? []) {
        expect(source).not.toContain(token)
      }
    })
  }

  it('Mermaid stays scheme-matched and does not follow RTWiki themes (Decision 2)', () => {
    const source = readWeb('features/rich-editor/blocks/mermaid-render.ts')
    expect(source).toContain("type MermaidTheme = 'default' | 'dark'")
    expect(source).toContain('...MERMAID_CONFIG, theme }')
    expect(source).not.toContain('var(--')
  })
})

// ---------------------------------------------------------------------------
// Gate C10 — pseudo / UA surface inventory
// ---------------------------------------------------------------------------

interface PseudoSurface {
  name: string
  file: string | null
  pattern: readonly string[]
  note: string
}

const PSEUDO_SURFACES: readonly PseudoSurface[] = [
  {
    name: '::selection',
    file: 'features/html-editor/editor-theme.ts',
    pattern: ['::selection', 'color-mix(', 'var(--mantine-color-text)'],
    note: 'CodeMirror selection mixes the text token (editor-theme.ts:26-28)'
  },
  {
    name: 'focus ring — sidebar',
    file: 'layout/sidebar.module.css',
    pattern: [':focus-visible', 'var(--rtwiki-focus-ring-width)', 'var(--mantine-color-blue-'],
    note: 'sidebar focus ring (sidebar.module.css:130)'
  },
  {
    name: 'focus ring — pane divider',
    file: 'layout/pane-divider.module.css',
    pattern: [':focus-visible', 'var(--rtwiki-focus-ring-width)', 'var(--mantine-color-blue-'],
    note: 'pane divider focus ring (pane-divider.module.css:41)'
  },
  {
    name: 'focus ring — tab strip',
    file: 'features/tabs/tab-strip.module.css',
    pattern: [':focus-visible', 'var(--rtwiki-focus-ring-width)', 'var(--mantine-color-blue-'],
    note: 'tab focus ring (tab-strip.module.css:167)'
  },
  {
    name: 'scrollbars — shared native',
    file: 'theme/customization.css',
    pattern: ['scrollbar-color', 'var(--rtwiki-scrollbar-thumb)', '::-webkit-scrollbar-thumb'],
    note: 'shared native scrollbar (customization.css:273-306)'
  },
  {
    name: 'scrollbars — KaTeX in editor',
    file: 'features/rich-editor/rich-editor.module.css',
    pattern: ['scrollbar-color', 'var(--rtwiki-scrollbar-thumb)', 'var(--rtwiki-scrollbar-track)'],
    note: 'KaTeX display scrollbar (rich-editor.module.css:112)'
  },
  {
    name: 'scrollbars — markdown preview',
    file: 'features/markdown/markdown-content.css',
    pattern: ['scrollbar-color', 'var(--rtwiki-scrollbar-thumb)', 'var(--rtwiki-scrollbar-track)'],
    note: 'markdown preview scrollbar (markdown-content.css:672)'
  },
  {
    name: 'scrollbars — sandboxed HTML preview',
    file: 'features/html/preview-document.ts',
    pattern: ['scrollbar-color', 'currentColor', '::-webkit-scrollbar'],
    note: 'iframe scrollbar follows currentColor (preview-document.ts:212-233)'
  },
  {
    name: 'caret',
    file: 'features/html-editor/editor-theme.ts',
    pattern: ['caretColor', 'var(--mantine-color-text)'],
    note: 'CodeMirror caret uses the text token (editor-theme.ts:24-25)'
  },
  {
    name: 'overlay / backdrop',
    file: null,
    pattern: [],
    note: 'No dedicated RTWiki pseudo/UA rule; Mantine theme supplies overlay and backdrop surfaces.'
  }
]

describe('C10 — pseudo / UA surface inventory', () => {
  for (const surface of PSEUDO_SURFACES) {
    it(surface.name, () => {
      if (surface.file === null) {
        // Documented absence — do not invent a rule that does not exist.
        expect(surface.note.length).toBeGreaterThan(0)
        return
      }
      const source = readWeb(surface.file)
      for (const token of surface.pattern) {
        expect(source).toContain(token)
      }
    })
  }
})
