import { type APIRequestContext, expect, type Frame, type Page, test } from '@playwright/test'

/**
 * Phase 4a — universal theme coverage in a real browser.
 *
 * The unit suites prove the theme *data* (tokens, contrast rules, adjustment
 * maths). This file proves the tokens actually reach painted pixels: Mantine
 * component internals, third-party widgets, the pre-paint bootstrap, the
 * sandboxed preview, live adjustments, OS scheme changes and accessibility
 * media features.
 *
 * Appearance is set through `PUT /api/settings/appearance` and the page is
 * reloaded, rather than clicking through Settings. The API is the same source
 * the pre-paint bootstrap reads, so a reload reproduces exactly what a user
 * sees on a cold start, without depending on a slow UI path.
 *
 * Thresholds: the contrast rule book lives in `src/web/theme/contrast-rules.ts`
 * (4.5 text / 3.0 UI / 3.0 readability floor). This file does not re-implement
 * WCAG maths; it asserts the *behavioural* contract — colours change with the
 * theme and foreground stays distinct from background. The `distinct()` helper
 * uses an 8/255 per-channel tolerance, which is deliberately looser than a
 * contrast ratio: it is a "not the same colour" check, not a WCAG gate.
 */

const THEMES = ['default', 'pastel-dreams', 'catppuccin', 'vercel'] as const

interface Appearance {
  themeId: string
  colorScheme: 'auto' | 'light' | 'dark'
  contrast: number
  glassOpacity: number
}

/** All 4 themes × both schemes — the C4 matrix. */
const COMBOS = THEMES.flatMap((themeId) =>
  (['light', 'dark'] as const).map((scheme) => ({ themeId, scheme }))
)

// ---------------------------------------------------------------------------
// Colour helpers (Node side)
// ---------------------------------------------------------------------------

interface Rgb {
  r: number
  g: number
  b: number
  a: number
}

/** Chromium's getComputedStyle returns `rgb(r, g, b)` / `rgba(r, g, b, a)`. */
function parseColor(value: string): Rgb | null {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(
    value.trim()
  )
  if (!match) return null
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4])
  }
}

function colorsClose(a: string, b: string, tolerance = 2): boolean {
  const left = parseColor(a)
  const right = parseColor(b)
  if (!left || !right) return a.trim() === b.trim()
  return (
    Math.abs(left.r - right.r) <= tolerance &&
    Math.abs(left.g - right.g) <= tolerance &&
    Math.abs(left.b - right.b) <= tolerance &&
    Math.abs(left.a - right.a) <= 0.02
  )
}

/** "Not the same colour" — a deliberately loose, non-vacuous readability check. */
function distinct(a: string, b: string): boolean {
  return !colorsClose(a, b, 8)
}

// ---------------------------------------------------------------------------
// Browser-side reading helpers
// ---------------------------------------------------------------------------

interface Reading {
  color: string
  background: string
  outlineColor: string
  scrollbarColor: string
}

async function readStyle(page: Page, selector: string): Promise<Reading | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el) return null
    const cs = getComputedStyle(el)
    return {
      color: cs.color,
      background: cs.backgroundColor,
      outlineColor: cs.outlineColor,
      scrollbarColor: cs.scrollbarColor
    }
  }, selector)
}

function requireReading(value: Reading | null, label: string): Reading {
  expect(value, `${label}: element must exist`).not.toBeNull()
  if (value === null) throw new Error(`${label}: element not found`)
  return value
}

/**
 * Resolves a CSS custom property (authored as `oklch(...)`) to the `rgb(...)`
 * string getComputedStyle reports, using a throwaway probe element. Comparing
 * an oklch token directly to a computed rgb value would always fail.
 */
async function resolveToken(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    const probe = document.createElement('span')
    probe.style.color = raw
    probe.style.position = 'absolute'
    document.body.appendChild(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    return resolved
  }, token)
}

// ---------------------------------------------------------------------------
// API / navigation helpers
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
// Fixtures — one rich page (BlockNote) and one HTML page (sandboxed preview)
// ---------------------------------------------------------------------------

let richPageId = ''
let htmlPageId = ''
let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

test.beforeAll(async ({ request }) => {
  const rich = await request.post('/api/pages', {
    data: { title: uniqueTitle('ThemeRich'), pageType: 'rich', content: '' }
  })
  expect(rich.status(), 'seed rich page').toBe(201)
  richPageId = ((await rich.json()) as { page: { id: string } }).page.id

  // The managed-source envelope is what the HTML workspace persists; a bare
  // string is rejected by the strict schema (see document-surfaces.pwspec.ts).
  const html = await request.post('/api/pages', {
    data: {
      title: uniqueTitle('ThemeHtml'),
      pageType: 'html',
      content: JSON.stringify({
        version: 2,
        html: '<h1>Theme probe</h1><p>Rendered body text.</p>',
        css: '',
        javascript: '',
        jsEnabled: false
      })
    }
  })
  expect(html.status(), 'seed html page').toBe(201)
  htmlPageId = ((await html.json()) as { page: { id: string } }).page.id
})

test.afterAll(async ({ request }) => {
  for (const id of [richPageId, htmlPageId]) {
    if (!id) continue
    try {
      await request.delete(`/api/pages/${id}`)
    } catch {
      // Already deleted — nothing to clean up.
    }
  }
})

// ===========================================================================
// C4 — Mantine component internals
// ===========================================================================

test.describe('C4 — Mantine component internals', () => {
  test('filled-family, disabled and default-variant controls stay themed and distinct across all 8 theme × scheme combinations', async ({
    page,
    request
  }) => {
    const buttonTexts: string[] = []

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

      // Filled-family control: `variant="light"` paints a solid, primary-derived
      // background. The Settings surface has no `variant="filled"` Button; this
      // is the closest real filled-family control available without opening a
      // modal, and it is enough to prove the primary token reaches a control.
      await settingsSection(page, 'Layout')
      const filled = requireReading(
        await readStyle(page, '[data-testid="settings-reset-layout"]'),
        `${label} filled-family button`
      )
      expect(distinct(filled.color, filled.background), `${label} filled text vs background`).toBe(
        true
      )
      buttonTexts.push(filled.color)

      // Default-variant control: the settings filter TextInput keeps Mantine's
      // neutral input background. Phase 1 deliberately did NOT override the
      // risky `--mantine-color-default` mapping, so this must not flatten into
      // the primary-tinted fill above.
      const neutral = requireReading(
        await readStyle(page, 'input[placeholder="Filter settings"]'),
        `${label} default-variant input`
      )
      expect(
        distinct(neutral.background, filled.background),
        `${label} default-variant background must differ from filled-family background`
      ).toBe(true)

      // Disabled control: at the neutral adjustments both Reset buttons are
      // disabled. Mantine paints them with `--mantine-color-disabled-color`
      // (mapped to the theme's textMuted) on `--mantine-color-disabled` (left at
      // Mantine's own value). Text must remain distinguishable from the fill.
      await settingsSection(page, 'Appearance')
      const disabled = requireReading(
        await readStyle(page, '[data-testid="settings-workspace"] button:disabled'),
        `${label} disabled control`
      )
      expect(
        distinct(disabled.color, disabled.background),
        `${label} disabled text vs background`
      ).toBe(true)
    }

    // Non-vacuous: at least one theme/scheme pair must produce a different
    // computed text colour. Eight identical readings would mean the primary
    // token never reached the control.
    expect(
      new Set(buttonTexts).size,
      'filled-family button text colour must change across theme/scheme combinations'
    ).toBeGreaterThan(1)
  })
})

// ===========================================================================
// C8 / C10 — third-party and pseudo surfaces
// ===========================================================================

test.describe('C8/C10 — third-party and pseudo surfaces', () => {
  test('BlockNote editor text is readable and follows the RTWiki theme', async ({
    page,
    request
  }) => {
    const readings: Array<{ label: string; color: string }> = []
    // Three configurations so both kinds of change can be proven:
    //  [0] default/light vs [1] catppuccin/light -> pure theme change
    //  [1] catppuccin/light vs [2] catppuccin/dark -> scheme change
    for (const { themeId, scheme } of [
      { themeId: 'default', scheme: 'light' },
      { themeId: 'catppuccin', scheme: 'light' },
      { themeId: 'catppuccin', scheme: 'dark' }
    ] as const) {
      await setAppearance(request, {
        themeId,
        colorScheme: scheme,
        contrast: 100,
        glassOpacity: 100
      })
      await page.goto(`/?page=${richPageId}`)
      await expect(page.locator('.bn-editor.ProseMirror')).toBeVisible({ timeout: 20_000 })

      const label = `${themeId}/${scheme}`
      const editor = requireReading(
        await readStyle(page, '.bn-editor.ProseMirror'),
        `${label} BlockNote editor`
      )
      expect(distinct(editor.color, editor.background), `${label} editor text vs background`).toBe(
        true
      )

      // customization.css maps --bn-colors-editor-text to --rtwiki-text on
      // .bn-editor, so the painted text must equal the resolved theme token.
      const expectedText = await resolveToken(page, '--rtwiki-text')
      expect(
        colorsClose(editor.color, expectedText, 3),
        `${label} editor text must match the resolved --rtwiki-text token`
      ).toBe(true)
      readings.push({ label, color: editor.color })
    }

    expect(
      distinct(readings[0].color, readings[1].color),
      'BlockNote editor text must change between two light themes'
    ).toBe(true)
    expect(
      distinct(readings[1].color, readings[2].color),
      'BlockNote editor text must change between light and dark schemes'
    ).toBe(true)
  })

  test('a scrollbar-bearing surface derives its scrollbar colour from the theme text token', async ({
    page,
    request
  }) => {
    const scrollbarColors: string[] = []
    for (const themeId of ['default', 'catppuccin'] as const) {
      await setAppearance(request, {
        themeId,
        colorScheme: 'light',
        contrast: 100,
        glassOpacity: 100
      })
      await openApp(page)
      const surface = requireReading(
        await readStyle(page, '.rtwiki-scroll'),
        `${themeId} scrollbar surface`
      )
      // `--rtwiki-scrollbar-thumb` is a color-mix of `--mantine-color-text`,
      // which Phase 1 maps to the theme's text token. A non-empty, changing
      // scrollbar-color proves the third-party scrollbar follows the theme.
      expect(surface.scrollbarColor, `${themeId} scrollbar-color must be set`).not.toBe('')
      scrollbarColors.push(surface.scrollbarColor)
    }
    expect(
      distinct(scrollbarColors[0], scrollbarColors[1]),
      'scrollbar colour must change between themes'
    ).toBe(true)
  })

  test('focus-ring token is theme-derived; outline spot-check and ::selection are recorded', async ({
    page,
    request
  }) => {
    const focusTokens: string[] = []
    for (const themeId of ['default', 'vercel'] as const) {
      await setAppearance(request, {
        themeId,
        colorScheme: 'light',
        contrast: 100,
        glassOpacity: 100
      })
      await openApp(page)
      await openSettings(page)

      // Mantine's focus ring is `outline: 2px solid var(--mantine-primary-color-filled)`.
      // Reading the resolved custom property from a real Mantine Button is a
      // computed-style spot-check of the value that paints the ring.
      const token = await page.evaluate(() => {
        const button = document.querySelector(
          '[data-testid="settings-workspace"] button'
        ) as HTMLElement | null
        return button
          ? getComputedStyle(button).getPropertyValue('--mantine-primary-color-filled').trim()
          : ''
      })
      expect(token, `${themeId} focus-ring token must be present`).not.toBe('')
      focusTokens.push(token)
    }
    expect(
      colorsClose(focusTokens[0], focusTokens[1]),
      'focus-ring token must change between themes with different primary colours'
    ).toBe(false)

    // Attempt the literal outline read on a keyboard-focused control. If the
    // browser does not match :focus-visible for a programmatic focus, record a
    // skip rather than asserting a value that was never painted.
    await openSettings(page)
    const closeButton = page.getByRole('button', { name: 'Close settings' })
    await closeButton.focus()
    const focusVisible = await closeButton.evaluate((el) => el.matches(':focus-visible'))
    if (focusVisible) {
      const outline = await closeButton.evaluate((el) => getComputedStyle(el).outlineColor)
      expect(
        parseColor(outline),
        `focus outline colour must be a real colour: ${outline}`
      ).not.toBe(null)
    } else {
      test.info().annotations.push({
        type: 'skip',
        description:
          'Computed outline spot-check skipped: Chromium did not match :focus-visible ' +
          'for a programmatic focus in this context. The focus-ring token assertion ' +
          'above still proves the ring colour is theme-derived.'
      })
    }

    test.info().annotations.push({
      type: 'skip',
      description:
        '::selection computed styles are not reliably exposed by Chromium ' +
        'getComputedStyle; static source assertions cover this in Phase 2.'
    })
  })
})

// ===========================================================================
// D5 — no-flash / pre-paint
// ===========================================================================

test.describe('D5 — pre-paint bootstrap', () => {
  test('the pre-paint style is injected server-side with the active theme variables (JavaScript disabled)', async ({
    browser,
    request
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    try {
      for (const themeId of ['default', 'catppuccin'] as const) {
        for (const scheme of ['light', 'dark'] as const) {
          await setAppearance(request, {
            themeId,
            colorScheme: scheme,
            contrast: 100,
            glassOpacity: 100
          })
          const page = await context.newPage()
          await page.goto('/')
          const html = await page.content()

          // The <style> is emitted by the server, so it is present even with no
          // JavaScript at all. Both the RTWiki tokens and the Mantine surface
          // overrides must be there for the active theme.
          expect(html, `${themeId}/${scheme} pre-paint canvas`).toContain('--rtwiki-canvas:')
          expect(html, `${themeId}/${scheme} pre-paint text`).toContain('--rtwiki-text:')
          expect(html, `${themeId}/${scheme} Mantine text override`).toContain(
            '--mantine-color-text:'
          )
          expect(html, `${themeId}/${scheme} Mantine body override`).toContain(
            '--mantine-color-body:'
          )
          expect(html, `${themeId}/${scheme} scheme-specific block`).toContain(
            `data-mantine-color-scheme="${scheme}"`
          )

          // Record, do not fake: the data-* attributes are written by the inline
          // bootstrap script, which a JavaScript-disabled context cannot run.
          const attributesPresent = /data-rtwiki-theme=/.test(html)
          test.info().annotations.push({
            type: 'product-limitation',
            description:
              `JS-disabled ${themeId}/${scheme}: pre-paint style present=true, ` +
              `data-* attributes present=${attributesPresent}. The attributes are ` +
              'set by an inline script, so a fully JS-disabled first paint cannot ' +
              'select the scheme-specific variable block.'
          })
          await page.close()
        }
      }
    } finally {
      await context.close()
    }
  })

  test('pre-paint attributes and canvas resolve before React mounts', async ({
    browser,
    request
  }) => {
    const context = await browser.newContext()
    // Block the app's JS bundles so React never mounts. The inline bootstrap
    // script and the stylesheet <link> are not network JS, so both still run —
    // this isolates the pre-paint state exactly.
    await context.route('**/assets/*.js', (route) => route.abort())
    try {
      const canvases: string[] = []
      for (const themeId of ['default', 'catppuccin'] as const) {
        for (const scheme of ['light', 'dark'] as const) {
          await setAppearance(request, {
            themeId,
            colorScheme: scheme,
            contrast: 100,
            glassOpacity: 100
          })
          const page = await context.newPage()
          await page.goto('/')
          const attrs = await page.evaluate(() => {
            const root = document.documentElement
            return {
              theme: root.getAttribute('data-rtwiki-theme'),
              scheme: root.getAttribute('data-mantine-color-scheme'),
              contrast: root.getAttribute('data-rtwiki-contrast'),
              glass: root.getAttribute('data-rtwiki-glass-opacity')
            }
          })
          expect(attrs.theme, `${themeId}/${scheme} data-rtwiki-theme`).toBe(themeId)
          expect(attrs.scheme, `${themeId}/${scheme} data-mantine-color-scheme`).toBe(scheme)
          expect(attrs.contrast, `${themeId}/${scheme} data-rtwiki-contrast`).toBe('100')
          expect(attrs.glass, `${themeId}/${scheme} data-rtwiki-glass-opacity`).toBe('100')

          // A computed-style read of the canvas token: resolve the oklch token
          // and compare it with a probe painted from `var(--rtwiki-canvas)`.
          const expected = await resolveToken(page, '--rtwiki-canvas')
          const painted = await page.evaluate(() => {
            const probe = document.createElement('div')
            probe.style.background = 'var(--rtwiki-canvas)'
            document.body.appendChild(probe)
            const bg = getComputedStyle(probe).backgroundColor
            probe.remove()
            return bg
          })
          expect(
            colorsClose(painted, expected, 3),
            `${themeId}/${scheme} painted canvas must match the theme canvas token`
          ).toBe(true)
          canvases.push(expected)
          await page.close()
        }
      }
      // Every light theme intentionally uses oklch(1 0 0) (white) as its canvas,
      // so the canvas changes with the *scheme*, not between two light themes.
      expect(
        distinct(canvases[0], canvases[1]),
        'canvas token must change between the light and dark schemes'
      ).toBe(true)
    } finally {
      await context.close()
    }
  })
})

// ===========================================================================
// D4 — sandboxed iframe srcdoc
// ===========================================================================

test.describe('D4 — sandboxed preview document', () => {
  test('the iframe canvas and text follow the theme and carry a nonce-bearing CSP', async ({
    page,
    request
  }) => {
    const readings: Array<{ label: string; background: string; color: string }> = []

    // Three configurations so both kinds of change can be proven:
    //  [0] default/light vs [1] catppuccin/light -> pure theme change (text)
    //  [1] catppuccin/light vs [2] catppuccin/dark -> scheme change (canvas)
    // Every light theme intentionally uses a white canvas, so a light/light
    // pair cannot demonstrate a background change.
    const configurations = [
      { themeId: 'default', scheme: 'light' },
      { themeId: 'catppuccin', scheme: 'light' },
      { themeId: 'catppuccin', scheme: 'dark' }
    ] as const

    for (const { themeId, scheme } of configurations) {
      await setAppearance(request, {
        themeId,
        colorScheme: scheme,
        contrast: 100,
        glassOpacity: 100
      })
      // PreviewFrame reads the theme id from the html attribute at render time,
      // so a reload is required for it to rebuild the srcdoc with the new theme.
      await page.goto(`/?page=${htmlPageId}`)
      const iframe = page.getByTestId('preview-iframe')
      await expect(iframe).toBeVisible({ timeout: 20_000 })

      const label = `${themeId}/${scheme}`
      // The iframe element becoming visible does not mean its srcdoc frame has
      // attached yet — the browser creates the frame asynchronously after the
      // element is laid out. Poll the frame list and capture the frame from the
      // same callback that satisfies the assertion, so there is no gap between
      // the wait and the evaluate below.
      let frame: Frame | undefined
      await expect
        .poll(
          () => {
            frame = page.frames().find((candidate) => candidate.url().includes('about:srcdoc'))
            return frame !== undefined
          },
          { timeout: 20_000, message: `${label} srcdoc frame must attach` }
        )
        .toBe(true)
      if (!frame) throw new Error(`${label}: about:srcdoc frame not found`)

      const surface = await frame.evaluate(() => ({
        background: getComputedStyle(document.body).backgroundColor,
        color: getComputedStyle(document.body).color,
        csp:
          document
            .querySelector('meta[http-equiv="Content-Security-Policy"]')
            ?.getAttribute('content') ?? ''
      }))
      expect(surface.csp, `${label} CSP meta must exist`).not.toBe('')
      expect(surface.csp, `${label} CSP must carry a nonce`).toContain("'nonce-")

      const expectedCanvas = await resolveToken(page, '--rtwiki-canvas')
      const expectedText = await resolveToken(page, '--rtwiki-text')
      expect(
        colorsClose(surface.background, expectedCanvas, 3),
        `${label} iframe background must match the theme canvas`
      ).toBe(true)
      expect(
        colorsClose(surface.color, expectedText, 3),
        `${label} iframe text must match the theme text token`
      ).toBe(true)
      readings.push({ label, background: surface.background, color: surface.color })
    }

    expect(
      distinct(readings[0].color, readings[1].color),
      'iframe text must change between two light themes'
    ).toBe(true)
    expect(
      distinct(readings[1].background, readings[2].background),
      'iframe background must change between light and dark schemes'
    ).toBe(true)
  })
})

// ===========================================================================
// A6 — rapid slider changes (browser portion)
// ===========================================================================

test.describe('A6 — rapid adjustments', () => {
  test('rapid adjustments-change events settle on the last value with no stale state', async ({
    page,
    request
  }) => {
    await setAppearance(request, {
      themeId: 'default',
      colorScheme: 'light',
      contrast: 100,
      glassOpacity: 100
    })
    await openApp(page)

    const dispatch = (contrast: number, glassOpacity: number) =>
      page.evaluate(
        ({ c, g }) => {
          window.dispatchEvent(
            new CustomEvent('rtwiki:adjustments-change', {
              detail: { contrast: c, glassOpacity: g }
            })
          )
        },
        { c: contrast, g: glassOpacity }
      )

    const textToken = () => resolveToken(page, '--rtwiki-text')

    await dispatch(50, 100)
    await expect.poll(async () => textToken(), { timeout: 5_000 }).not.toBe('')
    const at50 = await textToken()

    await dispatch(150, 100)
    await expect.poll(async () => textToken(), { timeout: 5_000 }).not.toBe(at50)
    const at150 = await textToken()

    // Three more in one tick; the last one must win.
    await page.evaluate(() => {
      const values = [
        { contrast: 60, glassOpacity: 40 },
        { contrast: 140, glassOpacity: 90 },
        { contrast: 75, glassOpacity: 55 }
      ]
      for (const value of values) {
        window.dispatchEvent(new CustomEvent('rtwiki:adjustments-change', { detail: value }))
      }
    })
    await expect.poll(async () => textToken(), { timeout: 5_000 }).not.toBe(at150)
    const finalText = await textToken()

    // A single, isolated event with the same final value must produce the same
    // token — proving the rapid sequence left no stale intermediate value.
    await page.reload()
    await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
    await dispatch(75, 55)
    await expect.poll(async () => textToken(), { timeout: 5_000 }).not.toBe(at150)
    const referenceText = await textToken()
    expect(colorsClose(finalText, referenceText, 3), 'last write must win').toBe(true)

    const attrs = await page.evaluate(() => {
      const root = document.documentElement
      return {
        contrast: root.getAttribute('data-rtwiki-contrast'),
        glass: root.getAttribute('data-rtwiki-glass-opacity')
      }
    })
    expect(attrs.contrast, 'data-rtwiki-contrast must match the last event').toBe('75')
    expect(attrs.glass, 'data-rtwiki-glass-opacity must match the last event').toBe('55')
  })

  /**
   * A6 persistence — the REAL interaction → API → SQLite → reload path.
   *
   * The test above dispatches synthetic events; this one drives the actual
   * Mantine slider thumbs with the keyboard. Each keypress fires the slider's
   * `onChangeEnd`, which calls `PUT /api/settings/appearance` (the DB write).
   * Evidence is read three ways: the API response, the live computed style,
   * and the server-injected `--rtwiki-contrast` custom property after a reload
   * (which can only come from the database, not from in-memory React state).
   */
  test('real slider changes persist to the database and last-write-wins across reload (default light/dark)', async ({
    page,
    request
  }) => {
    test.setTimeout(120_000)

    const readApi = async (): Promise<Appearance> => {
      const res = await request.get('/api/settings/appearance')
      expect(res.status(), 'GET /api/settings/appearance').toBe(200)
      return (await res.json()) as Appearance
    }

    const readComputed = () =>
      page.evaluate(() => {
        const root = document.documentElement
        const cs = getComputedStyle(root)
        return {
          contrastAttr: root.getAttribute('data-rtwiki-contrast'),
          glassAttr: root.getAttribute('data-rtwiki-glass-opacity'),
          // Emitted by the server pre-paint bootstrap from the DB value; it can
          // only change after a reload that re-reads the database.
          contrastVar: cs.getPropertyValue('--rtwiki-contrast').trim(),
          glassVar: cs.getPropertyValue('--rtwiki-glass-opacity').trim(),
          text: cs.getPropertyValue('--rtwiki-text').trim()
        }
      })

    const stepSlider = async (name: string, key: 'ArrowLeft' | 'ArrowRight', times: number) => {
      const slider = page.getByRole('slider', { name })
      await expect(slider, `${name} slider must render`).toBeVisible()
      await slider.focus()
      for (let i = 0; i < times; i++) await slider.press(key)
    }

    for (const scheme of ['light', 'dark'] as const) {
      await setAppearance(request, {
        themeId: 'default',
        colorScheme: scheme,
        contrast: 100,
        glassOpacity: 100
      })
      await openApp(page)
      await openSettings(page)
      const label = `default/${scheme}`

      // Baseline: API and computed state agree at the neutral values.
      const initialApi = await readApi()
      expect(initialApi.contrast, `${label} initial API contrast`).toBe(100)
      expect(initialApi.glassOpacity, `${label} initial API glass`).toBe(100)
      const initialComputed = await readComputed()
      expect(initialComputed.contrastAttr, `${label} initial contrast attribute`).toBe('100')

      // REAL UI interaction: 100 → 60 in eight rapid -5 steps. Every keypress
      // fires onChangeEnd → PUT, so the last one must win in the database.
      await stepSlider('Contrast', 'ArrowLeft', 8)
      await expect.poll(async () => (await readApi()).contrast, { timeout: 10_000 }).toBe(60)
      const afterContrast = await readApi()
      expect(afterContrast.contrast, `${label} API contrast after slider`).toBe(60)
      expect(afterContrast.glassOpacity, `${label} API glass must be unchanged`).toBe(100)
      await expect
        .poll(async () => (await readComputed()).contrastAttr, { timeout: 10_000 })
        .toBe('60')
      const live = await readComputed()
      expect(live.text, `${label} live text token must change with contrast`).not.toBe(
        initialComputed.text
      )
      test.info().annotations.push({
        type: 'evidence',
        description:
          `${label} contrast slider → API {contrast:${String(afterContrast.contrast)},` +
          `glassOpacity:${String(afterContrast.glassOpacity)}}; ` +
          `computed {contrastAttr:${String(live.contrastAttr)},text:${live.text}}`
      })

      // Reload: the server-injected custom property can only come from SQLite.
      await page.reload()
      await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
      const reloadedApi = await readApi()
      expect(reloadedApi.contrast, `${label} API contrast after reload`).toBe(60)
      const reloaded = await readComputed()
      expect(reloaded.contrastAttr, `${label} contrast attribute after reload`).toBe('60')
      expect(reloaded.contrastVar, `${label} --rtwiki-contrast after reload`).toBe('0.6')
      expect(
        colorsClose(reloaded.text, live.text, 3),
        `${label} text token after reload must match the live value`
      ).toBe(true)
      test.info().annotations.push({
        type: 'evidence',
        description:
          `${label} after reload → API {contrast:${String(reloadedApi.contrast)}}; ` +
          `computed {contrastAttr:${String(reloaded.contrastAttr)},` +
          `contrastVar:${reloaded.contrastVar},text:${reloaded.text}}`
      })

      // Glass slider: 100 → 70 in six rapid steps, then reload.
      await openSettings(page)
      await stepSlider('Glass opacity', 'ArrowLeft', 6)
      await expect.poll(async () => (await readApi()).glassOpacity, { timeout: 10_000 }).toBe(70)
      const afterGlass = await readApi()
      expect(afterGlass.glassOpacity, `${label} API glass after slider`).toBe(70)
      expect(afterGlass.contrast, `${label} API contrast must be unchanged`).toBe(60)
      await page.reload()
      await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
      expect((await readApi()).glassOpacity, `${label} API glass after reload`).toBe(70)
      const glassReload = await readComputed()
      expect(glassReload.glassAttr, `${label} glass attribute after reload`).toBe('70')
      expect(glassReload.glassVar, `${label} --rtwiki-glass-opacity after reload`).toBe('0.7')

      // Rapid burst ending on a known value: 60 → 75 → 70. The last write must
      // win in the API, in the live computed style, and after another reload.
      await openSettings(page)
      await stepSlider('Contrast', 'ArrowRight', 3)
      await stepSlider('Contrast', 'ArrowLeft', 1)
      await expect.poll(async () => (await readApi()).contrast, { timeout: 10_000 }).toBe(70)
      const burstApi = await readApi()
      expect(burstApi.contrast, `${label} last rapid write must win in the API`).toBe(70)
      expect(burstApi.glassOpacity, `${label} glass must survive the burst`).toBe(70)
      await expect
        .poll(async () => (await readComputed()).contrastAttr, { timeout: 10_000 })
        .toBe('70')
      await page.reload()
      await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
      const finalApi = await readApi()
      expect(finalApi.contrast, `${label} last rapid write must survive reload`).toBe(70)
      expect(finalApi.glassOpacity, `${label} glass must survive reload`).toBe(70)
      const finalComputed = await readComputed()
      expect(finalComputed.contrastAttr, `${label} final contrast attribute`).toBe('70')
      expect(finalComputed.contrastVar, `${label} final --rtwiki-contrast`).toBe('0.7')
      expect(finalComputed.glassAttr, `${label} final glass attribute`).toBe('70')
      test.info().annotations.push({
        type: 'evidence',
        description:
          `${label} rapid burst → API {contrast:${String(finalApi.contrast)},` +
          `glassOpacity:${String(finalApi.glassOpacity)}}; ` +
          `computed {contrastAttr:${String(finalComputed.contrastAttr)},` +
          `contrastVar:${finalComputed.contrastVar},glassAttr:${String(finalComputed.glassAttr)}}`
      })
    }
  })
})

// ===========================================================================
// P2 — auto scheme + live OS flip, and manual persistence
// ===========================================================================

test.describe('P2 — colour scheme', () => {
  test('auto follows a live OS light/dark flip', async ({ page, request }) => {
    await setAppearance(request, {
      themeId: 'default',
      colorScheme: 'auto',
      contrast: 100,
      glassOpacity: 100
    })
    await page.emulateMedia({ colorScheme: 'dark' })
    await openApp(page)
    expect(
      await page.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme'))
    ).toBe('dark')
    const darkCanvas = await resolveToken(page, '--rtwiki-canvas')

    await page.emulateMedia({ colorScheme: 'light' })
    await expect
      .poll(
        () =>
          page.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme')),
        { timeout: 5_000 }
      )
      .toBe('light')
    const lightCanvas = await resolveToken(page, '--rtwiki-canvas')
    expect(distinct(darkCanvas, lightCanvas), 'canvas must change with the OS scheme').toBe(true)
  })

  test('a manual scheme choice persists across reload', async ({ page, request }) => {
    await setAppearance(request, {
      themeId: 'default',
      colorScheme: 'dark',
      contrast: 100,
      glassOpacity: 100
    })
    await page.emulateMedia({ colorScheme: 'light' })
    await openApp(page)
    expect(
      await page.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme'))
    ).toBe('dark')

    await page.reload()
    await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
    expect(
      await page.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme')),
      'manual dark choice must survive a reload against a light OS'
    ).toBe('dark')
  })
})

// ===========================================================================
// P4 — accessibility environments (basic checks only)
// ===========================================================================

test.describe('P4 — accessibility media features', () => {
  for (const [name, media] of [
    ['reduced motion', { reducedMotion: 'reduce' as const }],
    ['forced colours', { forcedColors: 'active' as const }],
    ['increased contrast', { contrast: 'more' as const }]
  ] as const) {
    test(`${name}: the app renders and text stays readable`, async ({ page, request }) => {
      await setAppearance(request, {
        themeId: 'default',
        colorScheme: 'light',
        contrast: 100,
        glassOpacity: 100
      })
      await page.emulateMedia(media)
      await openApp(page)

      // No crash: the shell and its text are present.
      await expect(page.getByTestId('page-tree')).toBeVisible()
      const body = requireReading(await readStyle(page, 'body'), `${name} body`)
      expect(
        distinct(body.color, body.background),
        `${name}: body text must remain distinct from its background`
      ).toBe(true)
    })
  }

  /**
   * Owner decision 4 puts forced-colors IN scope as a one-time unreadability
   * check. The loop above exercises it in the light scheme only; this dedicated
   * case covers default light AND dark so a forced-colors regression in the dark
   * scheme cannot hide behind the light-only probe. It is a real browser
   * computed-style check: emulateMedia drives Chromium's forced-colors mode and
   * `distinct()` compares the painted body text against its painted background.
   */
  test('forced colours: body text stays readable in default light and dark', async ({
    page,
    request
  }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await setAppearance(request, {
        themeId: 'default',
        colorScheme: scheme,
        contrast: 100,
        glassOpacity: 100
      })
      await page.emulateMedia({ forcedColors: 'active' })
      await openApp(page)

      await expect(page.getByTestId('page-tree')).toBeVisible()
      const body = requireReading(await readStyle(page, 'body'), `forced colours ${scheme} body`)
      expect(
        distinct(body.color, body.background),
        `forced colours ${scheme}: body text must remain distinct from its background`
      ).toBe(true)
    }
  })

  /**
   * Finding 1: Mantine's `respectReducedMotion` does not reach RTWiki's own CSS
   * transitions. This is a REAL computed-style check — it reads
   * `getComputedStyle(el).transitionDuration` on representative RTWiki-owned
   * elements, first with normal motion and then with `reducedMotion: 'reduce'`.
   * A fresh context per scheme keeps workspace-session restore from reopening a
   * tab and hiding the dashboard between the two states.
   */
  test('reduced motion collapses RTWiki-owned transition durations to 0s (default light/dark)', async ({
    browser,
    request
  }) => {
    test.setTimeout(120_000)

    interface Probe {
      label: string
      selector: string
    }
    // Each transition lives in a CSS module (hashed class), so the probes use
    // stable global hooks that survive class-name hashing.
    const DASHBOARD_PROBES: readonly Probe[] = [
      { label: 'page-card', selector: '[data-page-type]' },
      { label: 'tree row', selector: 'div.wb-row:has(span.wb-node)' },
      { label: 'nav link (Home entry)', selector: '[data-testid="tree-root-entry"]' }
    ]
    const PAGE_PROBES: readonly Probe[] = [
      { label: 'tab', selector: '[role="tab"]' },
      { label: 'tree row', selector: 'div.wb-row:has(span.wb-node)' },
      { label: 'nav link (Home entry)', selector: '[data-testid="tree-root-entry"]' }
    ]

    const readDurations = (target: Page, probes: readonly Probe[]) =>
      target.evaluate((items) => {
        const result: Record<string, string | null> = {}
        for (const item of items) {
          const el = document.querySelector(item.selector) as HTMLElement | null
          result[item.label] = el ? getComputedStyle(el).transitionDuration : null
        }
        return result
      }, probes)

    const parseDurations = (value: string): number[] =>
      value
        .split(',')
        .map((part) => Number.parseFloat(part.trim()))
        .filter((n) => Number.isFinite(n))

    const assertPair = (
      normal: Record<string, string | null>,
      reduced: Record<string, string | null>,
      probes: readonly Probe[],
      label: string
    ): void => {
      for (const probe of probes) {
        const before = normal[probe.label]
        const after = reduced[probe.label]
        expect(before, `${label} normal ${probe.label} must exist`).not.toBeNull()
        expect(after, `${label} reduced ${probe.label} must exist`).not.toBeNull()
        if (before === null || after === null) continue
        const beforeValues = parseDurations(before)
        const afterValues = parseDurations(after)
        expect(
          beforeValues.length,
          `${label} normal ${probe.label} must report a duration`
        ).toBeGreaterThan(0)
        expect(
          beforeValues.some((d) => d > 0),
          `${label} normal ${probe.label} must have a non-zero duration (got "${before}")`
        ).toBe(true)
        expect(
          afterValues.every((d) => d === 0),
          `${label} reduced ${probe.label} must be 0s (got "${after}")`
        ).toBe(true)
      }
    }

    for (const scheme of ['light', 'dark'] as const) {
      await setAppearance(request, {
        themeId: 'default',
        colorScheme: scheme,
        contrast: 100,
        glassOpacity: 100
      })
      const label = `default/${scheme}`
      const context = await browser.newContext()
      try {
        const page = await context.newPage()
        await page.setViewportSize({ width: 1280, height: 800 })

        // Dashboard state: page cards, tree rows and the Home nav entry.
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        await page.goto('/')
        await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
        await expect(page.locator('[data-page-type]').first()).toBeVisible({ timeout: 20_000 })
        const dashboardNormal = await readDurations(page, DASHBOARD_PROBES)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const dashboardReduced = await readDurations(page, DASHBOARD_PROBES)
        assertPair(dashboardNormal, dashboardReduced, DASHBOARD_PROBES, `${label} dashboard`)

        // Page state: an open tab plus the same tree/nav chrome.
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        await page.goto(`/?page=${richPageId}`)
        await expect(page.getByRole('tab').first()).toBeVisible({ timeout: 20_000 })
        const pageNormal = await readDurations(page, PAGE_PROBES)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const pageReduced = await readDurations(page, PAGE_PROBES)
        assertPair(pageNormal, pageReduced, PAGE_PROBES, `${label} page`)
      } finally {
        await context.close()
      }
    }
  })
})
