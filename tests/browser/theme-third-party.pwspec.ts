import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

/**
 * Gate C8 — computed-style conformance for third-party surfaces.
 *
 * S2 proves RTWiki's own CSS paints its SSoT tokens; C4 proves the same for
 * Mantine components. This spec closes the remaining third-party gap with the
 * SAME oracle approach: read the element's ACTUAL getComputedStyle value in a
 * real browser and compare it with the RESOLVED value of the SSoT custom
 * property it consumes (painted onto a probe through `var(--token)` so an
 * authored `oklch()` serializes exactly like the element's `rgb()`).
 *
 * The probes live on the permanent internal showcase page and use the exact
 * production modules: `CodeEditor`/`htmlEditorTheme` (CodeMirror),
 * `renderMarkdown` (KaTeX markup), and `renderMermaidSvg` (Mermaid). No
 * application source is changed to make a check pass; a genuine mismatch fails.
 */

const THEMES = ['default', 'pastel-dreams', 'catppuccin', 'vercel'] as const
const COMBOS = THEMES.flatMap((themeId) =>
  (['light', 'dark'] as const).map((scheme) => ({ themeId, scheme }))
)
const SHOWCASE_PATH = '/__theme_showcase'

/** S2/C4 tolerance contract: colour channels <=2/255, alpha <=0.02. */
const COLOR_CHANNEL_TOLERANCE = 2
const COLOR_ALPHA_TOLERANCE = 0.02
/** KaTeX's authored em ratio in markdown-content.css:542-544. */
const KATEX_FONT_RATIO = 1.04
/** KaTeX font-size comparison tolerance in px (sub-pixel rounding). */
const FONT_SIZE_TOLERANCE_PX = 0.5
/** CSS serialization of the `transparent` keyword (owner decision 2). */
const TRANSPARENT_BACKGROUND = 'rgba(0, 0, 0, 0)'

interface Appearance {
  themeId: string
  colorScheme: 'auto' | 'light' | 'dark'
  contrast: number
  glassOpacity: number
}

interface Rgb {
  r: number
  g: number
  b: number
  a: number
}

function oklchToRgb(l: number, c: number, hDeg: number, alpha: number): Rgb {
  const h = (hDeg * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b
  const L = l_ ** 3
  const M = m_ ** 3
  const S = s_ ** 3
  const linear = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S
  ]
  const gamma = (channel: number): number => {
    const encoded = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055
    return Math.round(Math.max(0, Math.min(1, encoded)) * 255)
  }
  return { r: gamma(linear[0]), g: gamma(linear[1]), b: gamma(linear[2]), a: alpha }
}

function parseColor(value: string): Rgb | null {
  const text = value.trim()
  const oklch = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(text)
  if (oklch) {
    return oklchToRgb(
      Number(oklch[1]),
      Number(oklch[2]),
      Number(oklch[3]),
      oklch[4] === undefined ? 1 : Number(oklch[4])
    )
  }
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(text)
  if (srgb) {
    return {
      r: Math.round(Number(srgb[1]) * 255),
      g: Math.round(Number(srgb[2]) * 255),
      b: Math.round(Number(srgb[3]) * 255),
      a: srgb[4] === undefined ? 1 : Number(srgb[4])
    }
  }
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(
    text
  )
  if (!match) return null
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4])
  }
}

function compareColor(actual: string, expected: string): { ok: boolean; delta: string } {
  const left = parseColor(actual)
  const right = parseColor(expected)
  if (!left || !right) {
    const ok = actual.trim() === expected.trim()
    return {
      ok,
      delta: ok ? '0 (exact serialization)' : `actual="${actual}" expected="${expected}"`
    }
  }
  const dr = Math.abs(left.r - right.r)
  const dg = Math.abs(left.g - right.g)
  const db = Math.abs(left.b - right.b)
  const da = Math.abs(left.a - right.a)
  return {
    ok:
      dr <= COLOR_CHANNEL_TOLERANCE &&
      dg <= COLOR_CHANNEL_TOLERANCE &&
      db <= COLOR_CHANNEL_TOLERANCE &&
      da <= COLOR_ALPHA_TOLERANCE,
    delta: `Δrgb=(${dr.toFixed(1)}, ${dg.toFixed(1)}, ${db.toFixed(1)}) Δa=${da.toFixed(3)}`
  }
}

interface Reading {
  found: boolean
  actual: string
  expected: string
}

/** Reads a computed property and the resolved SSoT token in the same browser tick. */
async function readStyle(
  page: Page,
  selector: string,
  property: string,
  token: string
): Promise<Reading> {
  return page.evaluate(
    ({ sel, prop, tokenName }) => {
      const element = document.querySelector(sel) as HTMLElement | null
      if (!element) return { found: false, actual: '', expected: '' }
      const actual = getComputedStyle(element).getPropertyValue(prop)
      const probe = document.createElement('span')
      probe.style.setProperty(prop, `var(${tokenName})`)
      probe.style.position = 'absolute'
      document.body.appendChild(probe)
      const expected = getComputedStyle(probe).getPropertyValue(prop)
      probe.remove()
      return { found: true, actual, expected }
    },
    { sel: selector, prop: property, tokenName: token }
  )
}

async function assertTokenColor(
  page: Page,
  label: string,
  selector: string,
  property: string,
  token: string
): Promise<void> {
  const reading = await readStyle(page, selector, property, token)
  expect(reading.found, `${label}: element "${selector}" must exist`).toBe(true)
  const result = compareColor(reading.actual, reading.expected)
  expect(
    result.ok,
    `${label} ${selector} :: ${property}\n  SSoT var: ${token}\n  expected: ${reading.expected}\n  actual:   ${reading.actual}\n  delta:    ${result.delta}`
  ).toBe(true)
}

async function setAppearance(
  request: APIRequestContext,
  patch: Partial<Appearance>
): Promise<void> {
  const res = await request.put('/api/settings/appearance', { data: patch })
  expect(res.status(), `PUT /api/settings/appearance ${JSON.stringify(patch)}`).toBe(200)
}

async function openShowcase(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(SHOWCASE_PATH)
  await expect(page.getByTestId('c4-button-filled')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-testid="c4-codemirror"] .cm-editor')).toBeVisible({
    timeout: 20_000
  })
  await expect(page.locator('[data-testid="c4-katex"] .katex')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-testid="c4-mermaid"][data-render-state="ok"] svg')).toBeVisible({
    timeout: 30_000
  })
}

test.describe('C8 — third-party computed-style conformance', () => {
  test('CodeMirror, KaTeX and Mermaid follow the theme across all 8 theme × scheme combinations', async ({
    page,
    request
  }) => {
    test.setTimeout(600_000)

    for (const { themeId, scheme } of COMBOS) {
      await setAppearance(request, {
        themeId,
        colorScheme: scheme,
        contrast: 100,
        glassOpacity: 100
      })
      await openShowcase(page)
      const label = `${themeId}/${scheme}`

      // --- CodeMirror (editor-theme.ts) ---
      await assertTokenColor(
        page,
        `${label} CodeMirror editor text`,
        '[data-testid="c4-codemirror"] .cm-editor',
        'color',
        '--mantine-color-text'
      )
      await assertTokenColor(
        page,
        `${label} CodeMirror gutter text`,
        '[data-testid="c4-codemirror"] .cm-gutters',
        'color',
        '--mantine-color-dimmed'
      )
      // CodeMirror's drawSelection() paints a custom caret: `.cm-content`
      // intentionally has `caret-color: transparent`, and the visible caret is
      // `.cm-cursor`'s left border (editor-theme.ts:25). Assert the real caret.
      await assertTokenColor(
        page,
        `${label} CodeMirror caret`,
        '[data-testid="c4-codemirror"] .cm-cursor',
        'border-left-color',
        '--mantine-color-text'
      )

      // --- KaTeX (markdown-content.css) ---
      await assertTokenColor(
        page,
        `${label} KaTeX text`,
        '[data-testid="c4-katex"] .katex',
        'color',
        '--mantine-color-text'
      )
      const katexSizes = await page.evaluate(() => {
        const katex = document.querySelector(
          '[data-testid="c4-katex"] .katex'
        ) as HTMLElement | null
        if (!katex?.parentElement) return null
        return {
          child: Number.parseFloat(getComputedStyle(katex).fontSize),
          parent: Number.parseFloat(getComputedStyle(katex.parentElement).fontSize)
        }
      })
      expect(katexSizes, `${label} KaTeX font-size probe must resolve`).not.toBeNull()
      if (!katexSizes) continue
      const expectedFontSize = katexSizes.parent * KATEX_FONT_RATIO
      expect(
        Math.abs(katexSizes.child - expectedFontSize),
        `${label} KaTeX font-size must stay ${KATEX_FONT_RATIO}× its parent (child=${katexSizes.child}, parent=${katexSizes.parent})`
      ).toBeLessThanOrEqual(FONT_SIZE_TOLERANCE_PX)

      // --- Mermaid (owner decision 2: scheme-matched, transparent) ---
      const mermaid = await page.evaluate(() => {
        const svg = document.querySelector('[data-testid="c4-mermaid"] svg') as SVGSVGElement | null
        if (!svg) return null
        return {
          background: getComputedStyle(svg).backgroundColor,
          hasRenderedContent: svg.querySelectorAll('g, path, rect, text').length > 0,
          publishedTheme: window.__C4_MERMAID_THEME__ ?? null
        }
      })
      expect(mermaid, `${label} Mermaid SVG must be present`).not.toBeNull()
      if (!mermaid) continue
      expect(mermaid.hasRenderedContent, `${label} Mermaid SVG must contain rendered content`).toBe(
        true
      )
      const transparent = parseColor(mermaid.background)
      expect(
        transparent !== null && transparent.a === 0,
        `${label} Mermaid SVG background must be transparent (got "${mermaid.background}"; expected ${TRANSPARENT_BACKGROUND})`
      ).toBe(true)
      expect(mermaid.publishedTheme, `${label} Mermaid theme must be scheme-matched`).toBe(
        scheme === 'dark' ? 'dark' : 'default'
      )
    }
  })
})
