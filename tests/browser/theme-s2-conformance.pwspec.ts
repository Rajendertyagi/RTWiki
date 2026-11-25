import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

/**
 * Gate S2 — computed-style conformance (the gate whose absence produced
 * "green static gates but half-themed app").
 *
 * Static gates prove a token is *declared*. This gate proves a token is
 * *painted*: for every enumerated element/property it reads the ACTUAL
 * getComputedStyle value in a real browser and compares it with the RESOLVED
 * value of the SSoT custom property that element's CSS rule consumes. The
 * oracle is never a hardcoded colour/length — it is read from
 * `getComputedStyle(document.documentElement).getPropertyValue(...)` (for
 * colours, resolved through a probe so `oklch()` becomes the same `rgb()`
 * serialization getComputedStyle reports on the element).
 *
 * Tolerances are named constants below: colour channels <=2/255, lengths
 * <=1px, z-index/duration/font-weight exact.
 *
 * The inventory is deliberately real screens, not isolated test components.
 * Each case carries the source file:line of the CSS rule that names the SSoT
 * variable, so a mismatch is an actionable worklist entry, not a black box.
 *
 * Narrow, documented exceptions (owner decisions 1 and 3) are encoded as data
 * with the specific Mantine variable and reason — never a blanket skip.
 */

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

const THEMES = ['default', 'pastel-dreams', 'catppuccin', 'vercel'] as const

/** All 4 themes x both schemes — the C4 matrix. */
const COMBOS = THEMES.flatMap((themeId) =>
  (['light', 'dark'] as const).map((scheme) => ({ themeId, scheme }))
)

interface Appearance {
  themeId: string
  colorScheme: 'auto' | 'light' | 'dark'
  contrast: number
  glassOpacity: number
}

// ---------------------------------------------------------------------------
// Named tolerances (the plan's tolerance contract)
// ---------------------------------------------------------------------------

/** Colour channels: <=2/255. */
const COLOR_CHANNEL_TOLERANCE = 2
/** Alpha channel: <=0.02. */
const COLOR_ALPHA_TOLERANCE = 0.02
/** Lengths: <=1px. */
const LENGTH_TOLERANCE_PX = 1
/** z-index, duration and font-weight are exact (no tolerance constant needed). */

type ValueClass = 'color' | 'length' | 'duration' | 'z-index' | 'font-weight'

interface ConformanceCase {
  /** Stable, human-readable id used in failure titles. */
  id: string
  /** Stable selector (data-testid or Mantine/BlockNote global class). */
  selector: string
  /** Hyphenated CSS property read from getComputedStyle. */
  property: string
  /** The SSoT custom property that is the oracle. */
  token: string
  valueClass: ValueClass
  /** file:line of the CSS rule that consumes `token` (documentation). */
  source: string
}

interface MantineDefaultException {
  id: string
  selector: string
  property: string
  /** The specific Mantine variable that legitimately owns this value. */
  variable: string
  reason: string
  source: string
}

// ---------------------------------------------------------------------------
// Colour / value helpers (Node side)
// ---------------------------------------------------------------------------

interface Rgb {
  r: number
  g: number
  b: number
  a: number
}

/**
 * Oklch -> sRGB 0-255 using the same Björn Ottosson matrices as the
 * application's own `src/web/theme/contrast.ts`, so the oracle compares
 * channels rather than serialization strings.
 */
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

/**
 * Normalizes every colour serialization getComputedStyle can emit into RGB
 * channels: `rgb()/rgba()`, `oklch()` (authored tokens) and `color(srgb ...)`.
 */
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

function parseLength(value: string): number | null {
  const match = /^(-?[\d.]+)px$/.exec(value.trim())
  return match ? Number(match[1]) : null
}

/** Normalize `120ms` and `0.12s` to milliseconds. */
function parseDuration(value: string): number | null {
  const text = value.trim()
  const ms = /^(-?[\d.]+)ms$/.exec(text)
  if (ms) return Number(ms[1])
  const seconds = /^(-?[\d.]+)s$/.exec(text)
  if (seconds) return Number(seconds[1]) * 1000
  return null
}

interface Comparison {
  ok: boolean
  delta: string
}

function compareValue(valueClass: ValueClass, actual: string, expected: string): Comparison {
  if (valueClass === 'color') {
    const left = parseColor(actual)
    const right = parseColor(expected)
    if (!left || !right) {
      // Both values come from getComputedStyle, so an unparsable pair is still
      // comparable by exact serialization (e.g. an oklch() the browser kept).
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
    const ok =
      dr <= COLOR_CHANNEL_TOLERANCE &&
      dg <= COLOR_CHANNEL_TOLERANCE &&
      db <= COLOR_CHANNEL_TOLERANCE &&
      da <= COLOR_ALPHA_TOLERANCE
    return {
      ok,
      delta: `Δrgb=(${dr.toFixed(1)}, ${dg.toFixed(1)}, ${db.toFixed(1)}) Δa=${da.toFixed(3)} (tol ${COLOR_CHANNEL_TOLERANCE}/255)`
    }
  }

  if (valueClass === 'length') {
    const left = parseLength(actual)
    const right = parseLength(expected)
    if (left === null || right === null) {
      return { ok: false, delta: `unparseable actual="${actual}" expected="${expected}"` }
    }
    const delta = Math.abs(left - right)
    return {
      ok: delta <= LENGTH_TOLERANCE_PX,
      delta: `Δ=${delta.toFixed(2)}px (tol ${LENGTH_TOLERANCE_PX}px)`
    }
  }

  if (valueClass === 'duration') {
    const left = parseDuration(actual)
    const right = parseDuration(expected)
    if (left === null || right === null) {
      return { ok: false, delta: `unparseable actual="${actual}" expected="${expected}"` }
    }
    const delta = Math.abs(left - right)
    return { ok: delta === 0, delta: `Δ=${delta}ms (exact)` }
  }

  // z-index and font-weight: exact numeric comparison.
  const left = Number.parseFloat(actual)
  const right = Number.parseFloat(expected)
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return { ok: false, delta: `unparseable actual="${actual}" expected="${expected}"` }
  }
  return { ok: left === right, delta: `actual=${left} expected=${right} (exact)` }
}

// ---------------------------------------------------------------------------
// Browser-side oracle reader
// ---------------------------------------------------------------------------

interface ConformanceReading {
  found: boolean
  actual: string
  expected: string
}

/**
 * Reads the element's computed property AND the SSoT variable's resolved value
 * in the same browser tick. For colours the token is painted onto a throwaway
 * probe so an authored `oklch(...)` is serialized exactly like the element's
 * computed `rgb(...)`; for lengths/z-index/durations the raw custom-property
 * value is already the resolved string.
 */
async function readConformance(page: Page, testCase: ConformanceCase): Promise<ConformanceReading> {
  return page.evaluate(
    ({ sel, prop, tokenName, cls }) => {
      const element = document.querySelector(sel) as HTMLElement | null
      if (!element) return { found: false, actual: '', expected: '' }
      const actual = getComputedStyle(element).getPropertyValue(prop)
      let expected = getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim()
      if (cls === 'color') {
        // Resolve the token through a probe using the SAME property AND the
        // same var() reference as the element. Chromium serializes a literal
        // `oklch(...)` as `oklch(...)`, but the same colour reached through a
        // custom property (as the element receives it) as `rgb(...)`. Using
        // `var(<token>)` on the probe reproduces the element's resolution path
        // exactly, so both sides serialize identically.
        const probe = document.createElement('span')
        probe.style.setProperty(prop, `var(${tokenName})`)
        probe.style.position = 'absolute'
        document.body.appendChild(probe)
        expected = getComputedStyle(probe).getPropertyValue(prop)
        probe.remove()
      }
      return { found: true, actual, expected }
    },
    {
      sel: testCase.selector,
      prop: testCase.property,
      tokenName: testCase.token,
      cls: testCase.valueClass
    }
  )
}

async function assertConformance(
  page: Page,
  label: string,
  testCase: ConformanceCase
): Promise<void> {
  const reading = await readConformance(page, testCase)
  expect(
    reading.found,
    `${label} [${testCase.id}]: element "${testCase.selector}" must exist`
  ).toBe(true)
  const result = compareValue(testCase.valueClass, reading.actual, reading.expected)
  expect(
    result.ok,
    [
      `${label} [${testCase.id}] ${testCase.selector} :: ${testCase.property}`,
      `  SSoT var : ${testCase.token} (${testCase.source})`,
      `  expected : ${reading.expected}`,
      `  actual   : ${reading.actual}`,
      `  delta    : ${result.delta}`
    ].join('\n')
  ).toBe(true)
}

function documentExceptions(label: string, exceptions: readonly MantineDefaultException[]): void {
  for (const exception of exceptions) {
    test.info().annotations.push({
      type: 'narrow-exception',
      description:
        `${label} [${exception.id}] ${exception.selector} :: ${exception.property} ` +
        `owned by ${exception.variable} (${exception.source}). ${exception.reason}`
    })
  }
}

// ---------------------------------------------------------------------------
// API / navigation helpers (reused from theme-universal.pwspec.ts)
// ---------------------------------------------------------------------------

async function setAppearance(
  request: APIRequestContext,
  patch: Partial<Appearance>
): Promise<Appearance> {
  const res = await request.put('/api/settings/appearance', { data: patch })
  expect(res.status(), `PUT /api/settings/appearance ${JSON.stringify(patch)}`).toBe(200)
  return (await res.json()) as Appearance
}

async function openApp(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
}

async function openSettings(page: Page): Promise<void> {
  await page.locator('nav[aria-label="RTWiki"] button[aria-label="Settings"]').click()
  await expect(page.getByTestId('settings-workspace')).toBeVisible({ timeout: 10_000 })
}

async function settingsSection(page: Page, label: string): Promise<void> {
  await page
    .getByTestId('settings-workspace')
    .locator('nav button')
    .filter({ hasText: label })
    .click()
}

// ---------------------------------------------------------------------------
// Fixtures — one rich page and one markdown page
// ---------------------------------------------------------------------------

let richPageId = ''
let markdownPageId = ''
let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

test.beforeAll(async ({ request }) => {
  const rich = await request.post('/api/pages', {
    data: { title: uniqueTitle('S2Rich'), pageType: 'rich', content: '' }
  })
  expect(rich.status(), 'seed rich page').toBe(201)
  richPageId = ((await rich.json()) as { page: { id: string } }).page.id

  const markdown = await request.post('/api/pages', {
    data: {
      title: uniqueTitle('S2Markdown'),
      pageType: 'markdown',
      content: JSON.stringify({ version: 1, markdown: '# Theme probe\n\nRendered body text.' })
    }
  })
  expect(markdown.status(), 'seed markdown page').toBe(201)
  markdownPageId = ((await markdown.json()) as { page: { id: string } }).page.id
})

test.afterAll(async ({ request }) => {
  for (const id of [richPageId, markdownPageId]) {
    if (!id) continue
    try {
      await request.delete(`/api/pages/${id}`)
    } catch {
      // Already deleted — nothing to clean up.
    }
  }
})

// ===========================================================================
// S2.1 — Shell chrome (dashboard, no tabs open)
// ===========================================================================

const SHELL_CHROME: readonly ConformanceCase[] = [
  {
    id: 'page-tree/bg',
    selector: '[data-testid="page-tree"]',
    property: 'background-color',
    token: '--rtwiki-pane',
    valueClass: 'color',
    source: 'src/web/layout/sidebar.module.css:5 (.sidebarRoot)'
  },
  {
    id: 'tree-home/text',
    selector: '[data-testid="tree-root-entry"]',
    property: 'color',
    token: '--rtwiki-text',
    valueClass: 'color',
    source: 'src/web/layout/sidebar.module.css:73 (.navItem)'
  },
  {
    id: 'status-bar/bg',
    selector: '[data-testid="workspace-status-bar"]',
    property: 'background-color',
    token: '--rtwiki-chrome-bg',
    valueClass: 'color',
    source: 'src/web/features/workspace/status-bar.module.css:12 (.bar)'
  },
  {
    id: 'status-bar/min-height',
    selector: '[data-testid="workspace-status-bar"]',
    property: 'min-height',
    token: '--rtwiki-status-bar-height',
    valueClass: 'length',
    source: 'src/web/features/workspace/status-bar.module.css:9 (.bar)'
  },
  {
    id: 'status-bar/border-top',
    selector: '[data-testid="workspace-status-bar"]',
    property: 'border-top-color',
    token: '--rtwiki-chrome-border',
    valueClass: 'color',
    source: 'src/web/features/workspace/status-bar.module.css:11 (.bar)'
  },
  {
    id: 'utility-rail/bg',
    selector: 'nav[aria-label="RTWiki"]',
    property: 'background-color',
    token: '--rtwiki-rail',
    valueClass: 'color',
    source: 'src/web/layout/utility-rail.module.css:12 (.rail)'
  }
]

test.describe('S2.1 — shell chrome conformance', () => {
  test('tab strip, sidebar, status bar and utility rail paint their SSoT tokens across all 8 combos', async ({
    page,
    request
  }) => {
    test.setTimeout(120_000)
    for (const { themeId, scheme } of COMBOS) {
      await setAppearance(request, {
        themeId,
        colorScheme: scheme,
        contrast: 100,
        glassOpacity: 100
      })
      await openApp(page)
      const label = `${themeId}/${scheme}`
      for (const testCase of SHELL_CHROME) {
        await assertConformance(page, label, testCase)
      }
    }
  })
})

// ===========================================================================
// S2.2 — Settings surfaces
// ===========================================================================

const SETTINGS_CASES: readonly ConformanceCase[] = [
  {
    id: 'settings-workspace/bg',
    selector: '[data-testid="settings-workspace"]',
    property: 'background-color',
    token: '--rtwiki-pane',
    valueClass: 'color',
    source: 'src/web/features/settings/settings.module.css:11 (.workspace)'
  },
  {
    id: 'settings-nav-active/bg',
    selector: '[data-testid="settings-workspace"] nav button[aria-current="page"]',
    property: 'background-color',
    token: '--rtwiki-active-fill',
    valueClass: 'color',
    source: 'src/web/features/settings/settings.module.css:75 (.navItemActive)'
  },
  {
    id: 'settings-nav-item/text',
    selector: '[data-testid="settings-workspace"] nav button:not([aria-current])',
    property: 'color',
    token: '--rtwiki-text',
    valueClass: 'color',
    source: 'src/web/features/settings/settings.module.css:66 (.navItem)'
  },
  {
    id: 'settings-filter-input/text',
    selector: 'input[placeholder="Filter settings"]',
    property: 'color',
    token: '--rtwiki-text',
    valueClass: 'color',
    source: 'src/web/theme/css-variables.ts:48 (--mantine-color-text -> text)'
  },
  {
    id: 'settings-filter-input/border',
    selector: 'input[placeholder="Filter settings"]',
    property: 'border-top-color',
    token: '--rtwiki-border',
    valueClass: 'color',
    source: 'src/web/theme/css-variables.ts:49 (--mantine-color-default-border -> border)'
  },
  {
    id: 'settings-reset-layout/text',
    selector: '[data-testid="settings-reset-layout"]',
    property: 'color',
    token: '--rtwiki-text',
    valueClass: 'color',
    source: 'src/web/theme/component-roles.ts:138 (light variant text -> foreground)'
  },
  {
    id: 'appearance-segmented/text',
    selector: '[data-testid="appearance-control"]',
    property: 'color',
    token: '--rtwiki-text',
    valueClass: 'color',
    source: 'src/web/theme/css-variables.ts:48 (--mantine-color-text -> text)'
  },
  {
    id: 'editor-switch/text',
    // The testid sits on Mantine's visually hidden <input class="mantine-Switch-input">,
    // whose color is the UA default black. The visible label/body is the control
    // that paints --rtwiki-text, so select it via :has() on the testid'd input.
    selector: '.mantine-Switch-body:has([data-testid="settings-word-wrap"])',
    property: 'color',
    token: '--rtwiki-text',
    valueClass: 'color',
    source: 'src/web/theme/css-variables.ts:48 (--mantine-color-text -> text)'
  }
]

/**
 * Owner decision 3: these three Mantine surface variables are deliberately NOT
 * overridden (they would flatten default/disabled controls). They are narrow,
 * documented exceptions — not skipped assertions relabelled as intentional.
 */
const SETTINGS_MANTINE_EXCEPTIONS: readonly MantineDefaultException[] = [
  {
    id: 'settings-filter-input/bg',
    selector: 'input[placeholder="Filter settings"]',
    property: 'background-color',
    variable: '--mantine-color-default',
    reason: 'Owner decision 3: risky surface kept at Mantine default; visual validation pending.',
    source: 'src/web/theme/css-variables.ts:63-67 (RISKY_SURFACE_MAPPINGS)'
  },
  {
    id: 'settings-reset-layout/bg',
    selector: '[data-testid="settings-reset-layout"]',
    property: 'background-color',
    variable: '--mantine-primary-color-light',
    reason:
      'Mantine owns the light-variant background (VARIANT_ROLES.light.background.source = mantine-default); only the text is RTWiki-owned.',
    source: 'src/web/theme/component-roles.ts:139'
  },
  {
    id: 'appearance-segmented/bg',
    selector: '[data-testid="appearance-control"]',
    property: 'background-color',
    variable: '--mantine-color-default',
    reason: 'Owner decision 3: SegmentedControl root uses the risky default surface.',
    source: 'src/web/theme/css-variables.ts:63-67 (RISKY_SURFACE_MAPPINGS)'
  },
  {
    id: 'editor-switch/track',
    selector: '.mantine-Switch-body:has([data-testid="settings-word-wrap"])',
    property: 'background-color',
    variable: '--mantine-color-default',
    reason: 'Owner decision 3: Switch track uses the risky default surface.',
    source: 'src/web/theme/css-variables.ts:63-67 (RISKY_SURFACE_MAPPINGS)'
  }
]

test.describe('S2.2 — settings surface conformance', () => {
  test('nav, buttons, inputs, segmented control and switch paint their SSoT tokens across all 8 combos', async ({
    page,
    request
  }) => {
    test.setTimeout(120_000)
    documentExceptions('S2.2', SETTINGS_MANTINE_EXCEPTIONS)
    for (const { themeId, scheme } of COMBOS) {
      await setAppearance(request, {
        themeId,
        colorScheme: scheme,
        contrast: 100,
        glassOpacity: 100
      })
      await openApp(page)
      await openSettings(page)
      const label = `${themeId}/${scheme}`

      // Appearance is the default section: workspace, nav, filter input and
      // the segmented control are all present. The reset-layout button and the
      // word-wrap switch live in other sections and are asserted below.
      for (const testCase of SETTINGS_CASES) {
        if (testCase.id === 'settings-reset-layout/text' || testCase.id === 'editor-switch/text') {
          continue
        }
        await assertConformance(page, label, testCase)
      }

      // The reset-layout button lives in the Layout section.
      await settingsSection(page, 'Layout')
      const resetLayoutCase = SETTINGS_CASES.find(
        (item) => item.id === 'settings-reset-layout/text'
      )
      if (!resetLayoutCase) throw new Error('S2.2: reset-layout case missing from inventory')
      await assertConformance(page, label, resetLayoutCase)

      // The Switch lives in the Editor section.
      await settingsSection(page, 'Editor')
      const switchCase = SETTINGS_CASES.find((item) => item.id === 'editor-switch/text')
      if (!switchCase) throw new Error('S2.2: editor-switch case missing from inventory')
      await assertConformance(page, label, switchCase)
    }
  })
})

// ===========================================================================
// S2.3 — Dashboard surfaces (page cards + a real Mantine Badge)
// ===========================================================================

const DASHBOARD_CASES: readonly ConformanceCase[] = [
  {
    id: 'page-card/bg',
    selector: '[data-page-type]',
    property: 'background-color',
    token: '--rtwiki-pane',
    valueClass: 'color',
    source: 'src/web/features/dashboard/page-card.module.css:12 (.card)'
  },
  {
    id: 'page-card/border',
    selector: '[data-page-type]',
    property: 'border-top-color',
    token: '--rtwiki-border',
    valueClass: 'color',
    source: 'src/web/features/dashboard/page-card.module.css:13 (.card)'
  }
]

test.describe('S2.3 — dashboard surface conformance', () => {
  test('page cards paint their SSoT tokens and the status badge is theme-stable across all 8 combos', async ({
    page,
    request
  }) => {
    test.setTimeout(120_000)
    // Decision 1 fixes status/neutral colours across THEMES, not across colour
    // schemes: Mantine's `-light` palette alias legitimately differs between
    // light and dark. Group by scheme and assert stability within each group.
    const badgeReadings = new Map<'light' | 'dark', Array<{ themeId: string; value: string }>>([
      ['light', []],
      ['dark', []]
    ])
    for (const { themeId, scheme } of COMBOS) {
      await setAppearance(request, {
        themeId,
        colorScheme: scheme,
        contrast: 100,
        glassOpacity: 100
      })
      await openApp(page)
      const label = `${themeId}/${scheme}`
      for (const testCase of DASHBOARD_CASES) {
        await assertConformance(page, label, testCase)
      }

      // Owner decision 1: status/neutral colours are fixed. The Trash header
      // Badge (variant="light" color="gray", owned by Mantine's fixed gray
      // palette --mantine-color-gray-light) must not change between themes.
      await page.getByTestId('trash-toggle').click()
      const badge = page.getByTestId('trash-count-badge')
      await expect(badge, `${label} trash badge must render`).toBeVisible({ timeout: 10_000 })
      badgeReadings.get(scheme)?.push({
        themeId,
        value: await badge.evaluate((element) => getComputedStyle(element).backgroundColor)
      })
    }
    for (const scheme of ['light', 'dark'] as const) {
      const readings = badgeReadings.get(scheme) ?? []
      const reference = readings[0]
      expect(reference, `S2.3 ${scheme}: trash badge readings must exist`).toBeDefined()
      if (!reference) continue
      // Normalize through the gate's colour helpers (parseColor/compareValue)
      // rather than raw string equality, so a serialization difference cannot
      // masquerade as a theme drift. The within-scheme stability contract
      // (decision 1) is unchanged: every theme must match the reference.
      const mismatches = readings
        .filter((reading) => !compareValue('color', reading.value, reference.value).ok)
        .map((reading) => `${reading.themeId}: ${reading.value}`)
      expect(
        mismatches,
        `S2.3 status badge background must be identical across all themes in ${scheme} ` +
          `(decision 1). Reference ${reference.themeId}=${reference.value}. ` +
          `Mismatches: ${JSON.stringify(mismatches)}. All: ${JSON.stringify(readings)}`
      ).toEqual([])
    }
  })
})

// ===========================================================================
// S2.4 — Document surfaces (rich editor, markdown preview, tab z-index, popover)
// ===========================================================================

const DOCUMENT_CASES: readonly ConformanceCase[] = [
  {
    id: 'tab-strip/bg',
    selector: '[data-testid="tab-strip"]',
    property: 'background-color',
    token: '--rtwiki-chrome-bg',
    valueClass: 'color',
    source: 'src/web/features/tabs/tab-strip.module.css:14 (.strip)'
  },
  {
    id: 'active-tab/bg',
    selector: '[role="tab"][data-page-id]',
    property: 'background-color',
    token: '--rtwiki-pane',
    valueClass: 'color',
    source: 'src/web/features/tabs/tab-strip.module.css:152 (.tabActive)'
  },
  {
    id: 'active-tab/text',
    selector: '[role="tab"][data-page-id]',
    property: 'color',
    token: '--rtwiki-text',
    valueClass: 'color',
    source: 'src/web/features/tabs/tab-strip.module.css:153 (.tabActive, via --mantine-color-text)'
  },
  {
    id: 'tab-drag-handle/z-index',
    selector: '[data-testid^="tab-drag-handle-"]',
    property: 'z-index',
    token: '--rtwiki-z-tab-handle',
    valueClass: 'z-index',
    source: 'src/web/features/tabs/tab-strip.module.css:120 (.tabDragHandle)'
  },
  {
    id: 'tab-close/z-index',
    selector: '[aria-label^="Close tab:"]',
    property: 'z-index',
    token: '--rtwiki-z-tab-close',
    valueClass: 'z-index',
    source: 'src/web/features/tabs/tab-strip.module.css:187 (.tabClose)'
  },
  {
    id: 'active-tab/z-index',
    selector: '[role="tab"][data-page-id]',
    property: 'z-index',
    token: '--rtwiki-z-tab-active',
    valueClass: 'z-index',
    source: 'src/web/features/tabs/tab-strip.module.css:159 (.tabActive)'
  },
  {
    id: 'rich-editor/text',
    selector: '.bn-editor.ProseMirror',
    property: 'color',
    token: '--rtwiki-text',
    valueClass: 'color',
    source: 'src/web/theme/customization.css:331 (--bn-colors-editor-text -> --rtwiki-text)'
  },
  {
    id: 'rich-editor/bg',
    selector: '.bn-editor.ProseMirror',
    property: 'background-color',
    token: '--rtwiki-canvas',
    valueClass: 'color',
    source: 'src/web/features/rich-editor/rich-editor.module.css:89 (.blockNoteWrapper .bn-editor)'
  },
  {
    id: 'markdown-preview/bg',
    selector: '[data-testid="markdown-rendered"]',
    property: 'background-color',
    token: '--rtwiki-canvas',
    valueClass: 'color',
    source: 'src/web/features/markdown/markdown-workspace.module.css:63 (.previewPane)'
  },
  {
    id: 'popover/bg',
    selector: '[data-testid="toolbar-overflow-panel"]',
    property: 'background-color',
    token: '--rtwiki-floating-bg',
    valueClass: 'color',
    source: 'src/web/theme/customization.css:178 (.rtwiki-floating)'
  }
]

test.describe('S2.4 — document surface conformance', () => {
  test('tabs, rich editor, markdown preview and popover paint their SSoT tokens across all 8 combos', async ({
    page,
    request
  }) => {
    test.setTimeout(180_000)
    for (const { themeId, scheme } of COMBOS) {
      await setAppearance(request, {
        themeId,
        colorScheme: scheme,
        contrast: 100,
        glassOpacity: 100
      })
      const label = `${themeId}/${scheme}`

      // Rich note: opens a tab (tab strip + z-index cases) and mounts BlockNote.
      await page.goto(`/?page=${richPageId}`)
      await expect(page.locator('.bn-editor.ProseMirror')).toBeVisible({ timeout: 20_000 })
      for (const testCase of DOCUMENT_CASES) {
        if (testCase.id === 'markdown-preview/bg' || testCase.id === 'popover/bg') continue
        await assertConformance(page, label, testCase)
      }

      // Popover: the toolbar overflow panel is a floating layer.
      await page.getByTestId('toolbar-more').click()
      const popover = page.getByTestId('toolbar-overflow-panel')
      await expect(popover, `${label} toolbar popover must open`).toBeVisible({ timeout: 10_000 })
      const popoverCase = DOCUMENT_CASES.find((item) => item.id === 'popover/bg')
      if (!popoverCase) throw new Error('S2.4: popover case missing from inventory')
      await assertConformance(page, label, popoverCase)

      // Markdown preview: default mode is 'preview', so the rendered surface
      // is present as soon as the workspace mounts.
      await page.goto(`/?page=${markdownPageId}`)
      await expect(page.getByTestId('markdown-rendered')).toBeVisible({ timeout: 20_000 })
      const markdownCase = DOCUMENT_CASES.find((item) => item.id === 'markdown-preview/bg')
      if (!markdownCase) throw new Error('S2.4: markdown case missing from inventory')
      await assertConformance(page, label, markdownCase)
    }
  })
})

// ===========================================================================
// S2.5 — Floating layers (modal, menu, tooltip)
// ===========================================================================

const FLOATING_CASES: readonly ConformanceCase[] = [
  {
    id: 'modal/bg',
    selector: '.mantine-Modal-content',
    property: 'background-color',
    token: '--rtwiki-floating-bg',
    valueClass: 'color',
    source: 'src/web/theme/customization.css:178 (.rtwiki-floating)'
  },
  {
    id: 'menu/bg',
    selector: '[data-testid="tree-context-menu"]',
    property: 'background-color',
    token: '--rtwiki-floating-bg',
    valueClass: 'color',
    source: 'src/web/theme/customization.css:178 (.rtwiki-floating)'
  },
  {
    id: 'tooltip/bg',
    selector: '.mantine-Tooltip-tooltip',
    property: 'background-color',
    token: '--rtwiki-floating-bg',
    valueClass: 'color',
    source: 'src/web/theme/customization.css:178 (.rtwiki-floating)'
  }
]

test.describe('S2.5 — floating layer conformance', () => {
  test('modal, menu and tooltip paint the floating SSoT token across all 8 combos', async ({
    page,
    request
  }) => {
    test.setTimeout(180_000)
    for (const { themeId, scheme } of COMBOS) {
      await setAppearance(request, {
        themeId,
        colorScheme: scheme,
        contrast: 100,
        glassOpacity: 100
      })
      await openApp(page)
      const label = `${themeId}/${scheme}`

      // Modal: the New page dialog.
      await page.locator('[aria-label="New page"]').first().click()
      const dialog = page.getByRole('dialog')
      await expect(dialog, `${label} modal must open`).toBeVisible({ timeout: 10_000 })
      const modalCase = FLOATING_CASES.find((item) => item.id === 'modal/bg')
      if (!modalCase) throw new Error('S2.5: modal case missing from inventory')
      await assertConformance(page, label, modalCase)
      await page.keyboard.press('Escape')
      await expect(dialog, `${label} modal must close`).toBeHidden({ timeout: 10_000 })

      // Menu: the page-tree context menu.
      await page.getByTestId('page-tree').click({ button: 'right', position: { x: 10, y: 10 } })
      const menu = page.getByTestId('tree-context-menu')
      await expect(menu, `${label} context menu must open`).toBeVisible({ timeout: 10_000 })
      const menuCase = FLOATING_CASES.find((item) => item.id === 'menu/bg')
      if (!menuCase) throw new Error('S2.5: menu case missing from inventory')
      await assertConformance(page, label, menuCase)
      await page.keyboard.press('Escape')
      await expect(menu, `${label} context menu must close`).toBeHidden({ timeout: 10_000 })

      // Tooltip: the utility rail's tree toggle carries a Mantine Tooltip.
      // Mantine cross-fades tooltips, so a stale tooltip from the earlier
      // interactions can still be mounted while the new one appears. Waiting
      // for a clean slate and then exactly one tooltip stops the read below
      // from latching onto a stale element that is about to be removed.
      const tooltips = page.locator('.mantine-Tooltip-tooltip')
      await expect(tooltips, `${label} stale tooltips must close`).toHaveCount(0)
      await page.getByTestId('tree-toggle').hover()
      await expect(tooltips, `${label} tooltip must appear`).toHaveCount(1)
      const tooltip = tooltips.first()
      await expect(tooltip, `${label} tooltip must be visible`).toBeVisible({ timeout: 10_000 })
      const tooltipCase = FLOATING_CASES.find((item) => item.id === 'tooltip/bg')
      if (!tooltipCase) throw new Error('S2.5: tooltip case missing from inventory')
      await assertConformance(page, label, tooltipCase)
    }
  })
})

// ===========================================================================
// S2.6 — Adjustment-sensitive properties (focused subset, bounded)
// ===========================================================================

const ADJUSTMENT_CASES: readonly ConformanceCase[] = [
  {
    id: 'floating-bg/contrast+glass',
    selector: '.mantine-Modal-content',
    property: 'background-color',
    token: '--rtwiki-floating-bg',
    valueClass: 'color',
    source: 'src/web/theme/css-variables.ts:138-146 (applyGlass on elevated)'
  },
  {
    id: 'text/contrast',
    selector: '[data-testid="tree-root-entry"]',
    property: 'color',
    token: '--rtwiki-text',
    valueClass: 'color',
    source: 'src/web/theme/css-variables.ts:127-132 (applyContrast on text)'
  }
]

test.describe('S2.6 — adjustment-sensitive conformance', () => {
  test('floating background and text follow their SSoT tokens at contrast 50/100/150 and glass 30/100', async ({
    page,
    request
  }) => {
    test.setTimeout(120_000)
    const configs = [
      { contrast: 50, glassOpacity: 100 },
      { contrast: 100, glassOpacity: 100 },
      { contrast: 150, glassOpacity: 100 },
      { contrast: 100, glassOpacity: 30 }
    ] as const

    const floatingValues: string[] = []
    const textValues: string[] = []

    for (const config of configs) {
      await setAppearance(request, { themeId: 'default', colorScheme: 'light', ...config })
      await openApp(page)
      const label = `contrast=${config.contrast} glass=${config.glassOpacity}`

      await page.locator('[aria-label="New page"]').first().click()
      const dialog = page.getByRole('dialog')
      await expect(dialog, `${label} modal must open`).toBeVisible({ timeout: 10_000 })
      for (const testCase of ADJUSTMENT_CASES) {
        await assertConformance(page, label, testCase)
      }
      floatingValues.push(
        await page.evaluate(
          () =>
            getComputedStyle(document.querySelector('.mantine-Modal-content') as HTMLElement)
              .backgroundColor
        )
      )
      textValues.push(
        await page.evaluate(
          () =>
            getComputedStyle(
              document.querySelector('[data-testid="tree-root-entry"]') as HTMLElement
            ).color
        )
      )
      await page.keyboard.press('Escape')
      await expect(dialog, `${label} modal must close`).toBeHidden({ timeout: 10_000 })
    }

    // Non-vacuous: glass must actually move the floating background, and
    // contrast must actually move the text token.
    expect(
      new Set(floatingValues).size,
      'floating background must change with glass opacity'
    ).toBeGreaterThan(1)
    expect(new Set(textValues).size, 'text colour must change with contrast').toBeGreaterThan(1)
  })
})
