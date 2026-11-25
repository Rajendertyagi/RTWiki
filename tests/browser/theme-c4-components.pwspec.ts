import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

/**
 * Gate C4 — rendered Mantine component conformance.
 *
 * S2 proves the app's own CSS rules paint their SSoT tokens. C4 proves the same
 * for REAL Mantine components: every family/variant/state used by RTWiki is
 * rendered on the permanent internal showcase page (THEME_SHOWCASE_PATH) and
 * its ACTUAL getComputedStyle values are compared with the RESOLVED value of
 * the SSoT custom property that role consumes.
 *
 * The oracle is never a hardcoded colour. It is either:
 *   - an RTWiki token chosen by the authoritative role table in
 *     component-roles.ts (published on window by the showcase), or
 *   - the owning Mantine variable for fields the role table marks as
 *     Mantine-owned (decision 3: default/disabled surfaces, filled accent).
 * Both are read from the live browser and resolved through a probe so an
 * authored `oklch()` serializes exactly like the element's computed `rgb()`.
 *
 * Tolerances are the S2 contract: colour channels <=2/255, alpha <=0.02.
 * Narrow, documented exceptions (the three risky keys, decision 3) are encoded
 * as data with the owning variable — never a blanket skip.
 *
 * Every failure is collected into an actionable list naming component, variant,
 * state, property, expected role/var and actual value.
 */

// ---------------------------------------------------------------------------
// Matrix (reused from theme-s2-conformance.pwspec.ts)
// ---------------------------------------------------------------------------

const THEMES = ['default', 'pastel-dreams', 'catppuccin', 'vercel'] as const

/** All 4 themes x both schemes — the C4 matrix. */
const COMBOS = THEMES.flatMap((themeId) =>
  (['light', 'dark'] as const).map((scheme) => ({ themeId, scheme }))
)

const SHOWCASE_PATH = '/__theme_showcase'

interface Appearance {
  themeId: string
  colorScheme: 'auto' | 'light' | 'dark'
  contrast: number
  glassOpacity: number
}

// ---------------------------------------------------------------------------
// Named tolerances (the S2 tolerance contract)
// ---------------------------------------------------------------------------

/** Colour channels: <=2/255. */
const COLOR_CHANNEL_TOLERANCE = 2
/** Alpha channel: <=0.02. */
const COLOR_ALPHA_TOLERANCE = 0.02

// ---------------------------------------------------------------------------
// Colour helpers (Node side) — copied from the S2 gate
// ---------------------------------------------------------------------------

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

interface Comparison {
  ok: boolean
  delta: string
}

function compareColor(actual: string, expected: string): Comparison {
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

// ---------------------------------------------------------------------------
// Oracle model
// ---------------------------------------------------------------------------

type Field = 'text' | 'background' | 'border' | 'hover'

interface RoleTokens {
  variant: Record<string, Record<string, string | null>>
  interaction: Record<string, Record<string, string | null>>
}

type Oracle =
  /** Token chosen by the authoritative role table in component-roles.ts. */
  | { kind: 'role'; table: 'variant' | 'interaction'; name: string; field: Field }
  /** A root-scope CSS custom property (RTWiki token or owning Mantine variable). */
  | { kind: 'root'; token: string }
  /** A custom property Mantine sets on the element itself (its SSoT for a slot). */
  | { kind: 'element'; token: string }

interface C4Case {
  id: string
  component: string
  variant: string
  state: string
  selector: string
  property: string
  pseudo?: string
  oracle: Oracle
  /** file:line of the role/ownership decision (documentation). */
  source: string
}

function c(
  id: string,
  component: string,
  variant: string,
  state: string,
  selector: string,
  property: string,
  oracle: Oracle,
  source: string,
  pseudo?: string
): C4Case {
  return { id, component, variant, state, selector, property, oracle, source, pseudo }
}

function role(table: 'variant' | 'interaction', name: string, field: Field): Oracle {
  return { kind: 'role', table, name, field }
}

function root(token: string): Oracle {
  return { kind: 'root', token }
}

function element(token: string): Oracle {
  return { kind: 'element', token }
}

/** Resolves a case's oracle to a concrete {token, scope}; null = no RTWiki var. */
function resolveOracle(
  testCase: C4Case,
  tokens: RoleTokens
): { token: string; scope: 'root' | 'element' } | null {
  const oracle = testCase.oracle
  if (oracle.kind === 'root') return { token: oracle.token, scope: 'root' }
  if (oracle.kind === 'element') return { token: oracle.token, scope: 'element' }
  const token = tokens[oracle.table][oracle.name]?.[oracle.field]
  return token === null || token === undefined ? null : { token, scope: 'root' }
}

// ---------------------------------------------------------------------------
// Browser-side batch reader
// ---------------------------------------------------------------------------

interface ReadRequest {
  id: string
  selector: string
  property: string
  pseudo?: string
  token: string
  scope: 'root' | 'element'
}

interface Reading {
  id: string
  found: boolean
  actual: string
  expected: string
}

/**
 * Reads every case's computed property AND its SSoT variable's resolved value
 * in one browser tick. Colours are painted onto a throwaway probe so an
 * authored `oklch()` serializes exactly like the element's computed `rgb()`.
 */
async function readBatch(page: Page, requests: ReadRequest[]): Promise<Reading[]> {
  return page.evaluate((reqs) => {
    return reqs.map((req) => {
      const el = document.querySelector(req.selector) as HTMLElement | null
      if (!el) return { id: req.id, found: false, actual: '', expected: '' }
      const actual = getComputedStyle(el, req.pseudo).getPropertyValue(req.property)
      const raw =
        req.scope === 'element'
          ? getComputedStyle(el).getPropertyValue(req.token).trim()
          : getComputedStyle(document.documentElement).getPropertyValue(req.token).trim()
      const probe = document.createElement('span')
      probe.style.position = 'absolute'
      // For root scope, reproduce the element's var() resolution path exactly.
      // For element scope, the computed custom property is already resolved (or
      // is itself a var() reference); painting it directly resolves either form.
      probe.style.setProperty(req.property, req.scope === 'root' ? `var(${req.token})` : raw)
      document.body.appendChild(probe)
      const expected = getComputedStyle(probe).getPropertyValue(req.property)
      probe.remove()
      return { id: req.id, found: true, actual, expected }
    })
  }, requests)
}

interface Failure {
  combo: string
  component: string
  variant: string
  state: string
  property: string
  expectedRole: string
  expected: string
  actual: string
  delta: string
  source: string
}

function describeOracle(
  testCase: C4Case,
  resolved: { token: string; scope: 'root' | 'element' }
): string {
  const oracle = testCase.oracle
  if (oracle.kind === 'role')
    return `${oracle.table}.${oracle.name}.${oracle.field} -> ${resolved.token}`
  if (oracle.kind === 'element') return `element ${resolved.token}`
  return resolved.token
}

function collectFailures(
  label: string,
  cases: readonly C4Case[],
  tokens: RoleTokens,
  readings: Reading[]
): Failure[] {
  const byId = new Map(cases.map((item) => [item.id, item]))
  const failures: Failure[] = []
  for (const reading of readings) {
    const testCase = byId.get(reading.id)
    if (!testCase) throw new Error(`C4: no case for reading ${reading.id}`)
    if (!reading.found) {
      failures.push({
        combo: label,
        component: testCase.component,
        variant: testCase.variant,
        state: testCase.state,
        property: testCase.property,
        expectedRole: describeOracle(
          testCase,
          resolveOracle(testCase, tokens) ?? { token: '?', scope: 'root' }
        ),
        expected: '<element exists>',
        actual: '<element not found>',
        delta: `selector ${testCase.selector} missing`,
        source: testCase.source
      })
      continue
    }
    const resolved = resolveOracle(testCase, tokens)
    if (!resolved) {
      failures.push({
        combo: label,
        component: testCase.component,
        variant: testCase.variant,
        state: testCase.state,
        property: testCase.property,
        expectedRole: `${testCase.oracle.kind} oracle`,
        expected: '<mapped SSoT var>',
        actual: reading.actual,
        delta: 'role has no RTWiki-owned CSS variable',
        source: testCase.source
      })
      continue
    }
    const result = compareColor(reading.actual, reading.expected)
    if (!result.ok) {
      failures.push({
        combo: label,
        component: testCase.component,
        variant: testCase.variant,
        state: testCase.state,
        property: testCase.property,
        expectedRole: describeOracle(testCase, resolved),
        expected: reading.expected,
        actual: reading.actual,
        delta: result.delta,
        source: testCase.source
      })
    }
  }
  return failures
}

function formatFailures(failures: Failure[]): string {
  if (failures.length === 0) return ''
  const lines = failures.map(
    (f) =>
      `  [${f.combo}] ${f.component}/${f.variant}/${f.state} :: ${f.property}\n` +
      `      expected role/var : ${f.expectedRole} (${f.source})\n` +
      `      expected value    : ${f.expected}\n` +
      `      actual value      : ${f.actual}\n` +
      `      delta             : ${f.delta}`
  )
  return `\n${failures.length} C4 conformance failure(s):\n${lines.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// API / navigation helpers (reused from the S2 gate)
// ---------------------------------------------------------------------------

async function setAppearance(
  request: APIRequestContext,
  patch: Partial<Appearance>
): Promise<Appearance> {
  const res = await request.put('/api/settings/appearance', { data: patch })
  expect(res.status(), `PUT /api/settings/appearance ${JSON.stringify(patch)}`).toBe(200)
  return (await res.json()) as Appearance
}

async function openShowcase(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(SHOWCASE_PATH)
  await expect(page.getByTestId('c4-button-filled')).toBeVisible({ timeout: 20_000 })
}

// ---------------------------------------------------------------------------
// Static case inventory — read on page load, no interaction
// ---------------------------------------------------------------------------

const STATIC_CASES: readonly C4Case[] = [
  // Button — filled (Mantine-owned accent fill + accent-contrast text)
  c(
    'button/filled/text',
    'Button',
    'filled',
    'normal',
    '[data-testid="c4-button-filled"]',
    'color',
    root('--mantine-color-white'),
    'component-roles.ts:132 (accent-contrast)'
  ),
  c(
    'button/filled/bg',
    'Button',
    'filled',
    'normal',
    '[data-testid="c4-button-filled"]',
    'background-color',
    element('--button-bg'),
    'component-roles.ts:133 (accent)'
  ),
  // Button — light (RTWiki text, Mantine accent tint)
  c(
    'button/light/text',
    'Button',
    'light',
    'normal',
    '[data-testid="c4-button-light"]',
    'color',
    role('variant', 'light', 'text'),
    'component-roles.ts:138'
  ),
  c(
    'button/light/bg',
    'Button',
    'light',
    'normal',
    '[data-testid="c4-button-light"]',
    'background-color',
    element('--button-bg'),
    'component-roles.ts:139'
  ),
  // Button — subtle (RTWiki text, transparent fill)
  c(
    'button/subtle/text',
    'Button',
    'subtle',
    'normal',
    '[data-testid="c4-button-subtle"]',
    'color',
    role('variant', 'subtle', 'text'),
    'component-roles.ts:144'
  ),
  c(
    'button/subtle/bg',
    'Button',
    'subtle',
    'normal',
    '[data-testid="c4-button-subtle"]',
    'background-color',
    element('--button-bg'),
    'component-roles.ts:145 (none)'
  ),
  // Button — outline (RTWiki text + border, transparent fill)
  c(
    'button/outline/text',
    'Button',
    'outline',
    'normal',
    '[data-testid="c4-button-outline"]',
    'color',
    role('variant', 'outline', 'text'),
    'component-roles.ts:157'
  ),
  c(
    'button/outline/border',
    'Button',
    'outline',
    'normal',
    '[data-testid="c4-button-outline"]',
    'border-top-color',
    role('variant', 'outline', 'border'),
    'component-roles.ts:158'
  ),
  c(
    'button/outline/bg',
    'Button',
    'outline',
    'normal',
    '[data-testid="c4-button-outline"]',
    'background-color',
    element('--button-bg'),
    'component-roles.ts:156 (none)'
  ),
  // Button — default (decision 3: neutral-default, not flattened)
  c(
    'button/default/text',
    'Button',
    'default',
    'normal',
    '[data-testid="c4-button-default"]',
    'color',
    root('--mantine-color-default-color'),
    'component-roles.ts:162 (neutral-default)'
  ),
  c(
    'button/default/bg',
    'Button',
    'default',
    'normal',
    '[data-testid="c4-button-default"]',
    'background-color',
    root('--mantine-color-default'),
    'css-variables.ts:63-67 (risky key, decision 3)'
  ),
  c(
    'button/default/border',
    'Button',
    'default',
    'normal',
    '[data-testid="c4-button-default"]',
    'border-top-color',
    root('--rtwiki-border'),
    'css-variables.ts:49 (default-border -> border)'
  ),
  // Button — disabled (decision 3: disabled surface preserved)
  c(
    'button/disabled/text',
    'Button',
    'light',
    'disabled',
    '[data-testid="c4-button-disabled"]',
    'color',
    root('--mantine-color-disabled-color'),
    'component-roles.ts:204 (muted via disabled-color)'
  ),
  c(
    'button/disabled/bg',
    'Button',
    'light',
    'disabled',
    '[data-testid="c4-button-disabled"]',
    'background-color',
    root('--mantine-color-disabled'),
    'css-variables.ts:63-67 (risky key, decision 3)'
  ),

  // ActionIcon — same variant roles as Button
  c(
    'actionicon/filled/text',
    'ActionIcon',
    'filled',
    'normal',
    '[data-testid="c4-actionicon-filled"]',
    'color',
    root('--mantine-color-white'),
    'component-roles.ts:132'
  ),
  c(
    'actionicon/light/text',
    'ActionIcon',
    'light',
    'normal',
    '[data-testid="c4-actionicon-light"]',
    'color',
    role('variant', 'light', 'text'),
    'component-roles.ts:138'
  ),
  c(
    'actionicon/subtle/text',
    'ActionIcon',
    'subtle',
    'normal',
    '[data-testid="c4-actionicon-subtle"]',
    'color',
    role('variant', 'subtle', 'text'),
    'component-roles.ts:144'
  ),
  c(
    'actionicon/outline/text',
    'ActionIcon',
    'outline',
    'normal',
    '[data-testid="c4-actionicon-outline"]',
    'color',
    role('variant', 'outline', 'text'),
    'component-roles.ts:157'
  ),
  c(
    'actionicon/outline/border',
    'ActionIcon',
    'outline',
    'normal',
    '[data-testid="c4-actionicon-outline"]',
    'border-top-color',
    role('variant', 'outline', 'border'),
    'component-roles.ts:158'
  ),
  c(
    'actionicon/default/bg',
    'ActionIcon',
    'default',
    'normal',
    '[data-testid="c4-actionicon-default"]',
    'background-color',
    root('--mantine-color-default'),
    'css-variables.ts:63-67 (risky key, decision 3)'
  ),
  c(
    'actionicon/disabled/bg',
    'ActionIcon',
    'light',
    'disabled',
    '[data-testid="c4-actionicon-disabled"]',
    'background-color',
    root('--mantine-color-disabled'),
    'css-variables.ts:63-67 (risky key, decision 3)'
  ),

  // Badge — accent variants
  c(
    'badge/light/text',
    'Badge',
    'light',
    'normal',
    '[data-testid="c4-badge-light"]',
    'color',
    role('variant', 'light', 'text'),
    'component-roles.ts:138'
  ),
  c(
    'badge/subtle/text',
    'Badge',
    'subtle',
    'normal',
    '[data-testid="c4-badge-subtle"]',
    'color',
    role('variant', 'subtle', 'text'),
    'component-roles.ts:144'
  ),
  c(
    'badge/filled/text',
    'Badge',
    'filled',
    'normal',
    '[data-testid="c4-badge-filled"]',
    'color',
    root('--mantine-color-white'),
    'component-roles.ts:132'
  ),
  c(
    'badge/filled/bg',
    'Badge',
    'filled',
    'normal',
    '[data-testid="c4-badge-filled"]',
    'background-color',
    element('--badge-bg'),
    'component-roles.ts:133'
  ),
  c(
    'badge/outline/text',
    'Badge',
    'outline',
    'normal',
    '[data-testid="c4-badge-outline"]',
    'color',
    role('variant', 'outline', 'text'),
    'component-roles.ts:157'
  ),
  c(
    'badge/outline/border',
    'Badge',
    'outline',
    'normal',
    '[data-testid="c4-badge-outline"]',
    'border-top-color',
    role('variant', 'outline', 'border'),
    'component-roles.ts:158'
  ),

  // Alert — accent variants (text follows role; background Mantine-owned)
  c(
    'alert/light/text',
    'Alert',
    'light',
    'normal',
    '[data-testid="c4-alert-light"]',
    'color',
    role('variant', 'light', 'text'),
    'component-roles.ts:138'
  ),
  c(
    'alert/light/bg',
    'Alert',
    'light',
    'normal',
    '[data-testid="c4-alert-light"]',
    'background-color',
    element('--alert-bg'),
    'component-roles.ts:139'
  ),
  c(
    'alert/filled/bg',
    'Alert',
    'filled',
    'normal',
    '[data-testid="c4-alert-filled"]',
    'background-color',
    element('--alert-bg'),
    'component-roles.ts:133'
  ),
  c(
    'alert/outline/text',
    'Alert',
    'outline',
    'normal',
    '[data-testid="c4-alert-outline"]',
    'color',
    role('variant', 'outline', 'text'),
    'component-roles.ts:157'
  ),

  // Inputs — default / disabled / placeholder
  c(
    'textinput/default/text',
    'TextInput',
    'default',
    'normal',
    '[data-testid="c4-textinput-default"]',
    'color',
    root('--mantine-color-text'),
    'css-variables.ts:47 (text -> --rtwiki-text)'
  ),
  c(
    'textinput/default/bg',
    'TextInput',
    'default',
    'normal',
    '[data-testid="c4-textinput-default"]',
    'background-color',
    element('--input-bg'),
    'Mantine Input.css (default surface)'
  ),
  c(
    'textinput/default/border',
    'TextInput',
    'default',
    'normal',
    '[data-testid="c4-textinput-default"]',
    'border-top-color',
    root('--rtwiki-border'),
    'theme-factory.ts:47-66 (--input-bd override)'
  ),
  c(
    'textinput/default/placeholder',
    'TextInput',
    'default',
    'placeholder',
    '[data-testid="c4-textinput-default"]',
    'color',
    root('--mantine-color-placeholder'),
    'css-variables.ts:51 (placeholder -> textMuted)',
    '::placeholder'
  ),
  c(
    'textinput/disabled/bg',
    'TextInput',
    'default',
    'disabled',
    '[data-testid="c4-textinput-disabled"]',
    'background-color',
    root('--mantine-color-disabled'),
    'css-variables.ts:63-67 (risky key, decision 3)'
  ),
  c(
    'textarea/default/text',
    'Textarea',
    'default',
    'normal',
    '[data-testid="c4-textarea-default"]',
    'color',
    root('--mantine-color-text'),
    'css-variables.ts:47'
  ),
  c(
    'textarea/default/border',
    'Textarea',
    'default',
    'normal',
    '[data-testid="c4-textarea-default"]',
    'border-top-color',
    root('--rtwiki-border'),
    'theme-factory.ts:47-66'
  ),
  c(
    'select/default/text',
    'Select',
    'default',
    'normal',
    '[data-testid="c4-select-default"]',
    'color',
    root('--mantine-color-text'),
    'css-variables.ts:47'
  ),
  c(
    'select/default/border',
    'Select',
    'default',
    'normal',
    '[data-testid="c4-select-default"]',
    'border-top-color',
    root('--rtwiki-border'),
    'theme-factory.ts:47-66'
  ),

  // Toggles — off / on / disabled
  c(
    'switch/off/bg',
    'Switch',
    'default',
    'off',
    '.c4-switch-track-off',
    'background-color',
    element('--switch-bg'),
    'Mantine Switch.css (off surface)'
  ),
  c(
    'switch/on/bg',
    'Switch',
    'filled',
    'on',
    '.c4-switch-track-on',
    'background-color',
    root('--mantine-primary-color-filled'),
    'Mantine Switch.css (--switch-color)'
  ),
  c(
    'switch/disabled/bg',
    'Switch',
    'default',
    'disabled',
    '.c4-switch-track-disabled',
    'background-color',
    root('--mantine-color-disabled'),
    'Mantine Switch.css (--switch-disabled-color)'
  ),
  c(
    'checkbox/off/bg',
    'Checkbox',
    'default',
    'off',
    '.c4-checkbox-input-off',
    'background-color',
    root('--rtwiki-pane'),
    'customization.css (resting box -> raised control surface)'
  ),
  c(
    'checkbox/on/bg',
    'Checkbox',
    'filled',
    'on',
    '.c4-checkbox-input-on',
    'background-color',
    root('--mantine-primary-color-filled'),
    'Mantine Checkbox.css (--checkbox-color)'
  ),
  c(
    'checkbox/disabled/bg',
    'Checkbox',
    'default',
    'disabled',
    '.c4-checkbox-input-disabled',
    'background-color',
    root('--mantine-color-disabled'),
    'Mantine Checkbox.css (disabled surface)'
  ),
  c(
    'radio/off/bg',
    'Radio',
    'default',
    'off',
    '.c4-radio-input-off',
    'background-color',
    root('--rtwiki-pane'),
    'customization.css (resting box -> raised control surface)'
  ),
  c(
    'radio/on/bg',
    'Radio',
    'filled',
    'on',
    '.c4-radio-input-on',
    'background-color',
    root('--mantine-primary-color-filled'),
    'Mantine Radio.css (--radio-color)'
  ),
  c(
    'radio/disabled/bg',
    'Radio',
    'default',
    'disabled',
    '.c4-radio-input-disabled',
    'background-color',
    root('--mantine-color-disabled'),
    'Mantine Radio.css (disabled surface)'
  ),

  // NavLink — default / selected / disabled (variant=light triggers the resolver)
  c(
    'navlink/default/text',
    'NavLink',
    'light',
    'normal',
    '[data-testid="c4-navlink-default"]',
    'color',
    root('--mantine-color-text'),
    'css-variables.ts:47 (inherited text)'
  ),
  c(
    'navlink/active/text',
    'NavLink',
    'light',
    'selected',
    '[data-testid="c4-navlink-active"]',
    'color',
    role('variant', 'light', 'text'),
    'component-roles.ts:138'
  ),
  c(
    'navlink/active/bg',
    'NavLink',
    'light',
    'selected',
    '[data-testid="c4-navlink-active"]',
    'background-color',
    element('--nl-bg'),
    'component-roles.ts:139 (accent)'
  ),
  c(
    'navlink/disabled/text',
    'NavLink',
    'light',
    'disabled',
    '[data-testid="c4-navlink-disabled"]',
    'color',
    root('--mantine-color-text'),
    'css-variables.ts:47 (inherited text)'
  ),

  // SegmentedControl — selected / default + hardcoded root surface
  c(
    'segmented/selected/text',
    'SegmentedControl',
    'default',
    'selected',
    '[data-testid="c4-segmented"] [data-active="true"]',
    'color',
    root('--mantine-color-text'),
    'css-variables.ts:47'
  ),
  c(
    'segmented/root/bg',
    'SegmentedControl',
    'default',
    'normal',
    '[data-testid="c4-segmented"]',
    'background-color',
    root('--rtwiki-pane'),
    'theme-factory.ts HARDCODED_SURFACE_SLOTS.SegmentedControl'
  ),

  // Kbd — hardcoded raised surface
  c(
    'kbd/root/bg',
    'Kbd',
    'default',
    'normal',
    '[data-testid="c4-kbd"]',
    'background-color',
    root('--rtwiki-pane'),
    'theme-factory.ts HARDCODED_SURFACE_SLOTS.Kbd'
  ),

  // Table / Paper / Card — surfaces
  c(
    'table/header/text',
    'Table',
    'default',
    'normal',
    '[data-testid="c4-table-th"]',
    'color',
    root('--mantine-color-text'),
    'css-variables.ts:47 (text -> --rtwiki-text)'
  ),
  c(
    'paper/bg',
    'Paper',
    'default',
    'normal',
    '[data-testid="c4-paper"]',
    'background-color',
    root('--mantine-color-body'),
    'css-variables.ts:48 (body -> canvas)'
  ),
  c(
    'card/bg',
    'Card',
    'default',
    'normal',
    '[data-testid="c4-card"]',
    'background-color',
    root('--mantine-color-body'),
    'css-variables.ts:48 (body -> canvas)'
  )
]

// ---------------------------------------------------------------------------
// Interaction case inventory — hover / focus / floating layers
// ---------------------------------------------------------------------------

const HOVER_CASES: readonly C4Case[] = [
  c(
    'button/filled/hover/bg',
    'Button',
    'filled',
    'hover',
    '[data-testid="c4-button-filled-hover"]',
    'background-color',
    element('--button-hover'),
    'component-roles.ts:135 (Mantine accent hover)'
  ),
  c(
    'button/light/hover/bg',
    'Button',
    'light',
    'hover',
    '[data-testid="c4-button-light-hover"]',
    'background-color',
    role('variant', 'light', 'hover'),
    'component-roles.ts:141 (surface-hover)'
  ),
  c(
    'button/subtle/hover/bg',
    'Button',
    'subtle',
    'hover',
    '[data-testid="c4-button-subtle-hover"]',
    'background-color',
    role('variant', 'subtle', 'hover'),
    'component-roles.ts:147 (surface-hover)'
  ),
  c(
    'button/outline/hover/bg',
    'Button',
    'outline',
    'hover',
    '[data-testid="c4-button-outline-hover"]',
    'background-color',
    role('variant', 'outline', 'hover'),
    'component-roles.ts:159 (surface-hover)'
  ),
  c(
    'navlink/active/hover/bg',
    'NavLink',
    'light',
    'hover',
    '[data-testid="c4-navlink-active"]',
    'background-color',
    role('interaction', 'hover', 'background'),
    'component-roles.ts:211 (surface-hover, via --nl-hover)'
  ),
  c(
    'navlink/default/hover/bg',
    'NavLink',
    'light',
    'hover',
    '[data-testid="c4-navlink-hover"]',
    'background-color',
    role('interaction', 'hover', 'background'),
    'customization.css (default hover -> --rtwiki-hover)'
  )
]

const FOCUS_CASES: readonly C4Case[] = [
  c(
    'button/light/focus/text',
    'Button',
    'light',
    'focus',
    '[data-testid="c4-button-light-focus"]',
    'color',
    role('variant', 'light', 'text'),
    'component-roles.ts:138 (text unchanged on focus)'
  ),
  c(
    'button/subtle/focus/text',
    'Button',
    'subtle',
    'focus',
    '[data-testid="c4-button-subtle-focus"]',
    'color',
    role('variant', 'subtle', 'text'),
    'component-roles.ts:144'
  ),
  c(
    'button/outline/focus/text',
    'Button',
    'outline',
    'focus',
    '[data-testid="c4-button-outline-focus"]',
    'color',
    role('variant', 'outline', 'text'),
    'component-roles.ts:157'
  )
]

const FLOATING_CASES: readonly C4Case[] = [
  c(
    'tooltip/bg',
    'Tooltip',
    'filled',
    'open',
    '.c4-tooltip-surface',
    'background-color',
    root('--rtwiki-floating-bg'),
    'customization.css:178'
  ),
  c(
    'popover/bg',
    'Popover',
    'default',
    'open',
    '.c4-popover-surface',
    'background-color',
    root('--rtwiki-floating-bg'),
    'customization.css:178'
  ),
  c(
    'modal/bg',
    'Modal',
    'default',
    'open',
    '.c4-modal-surface',
    'background-color',
    root('--rtwiki-floating-bg'),
    'customization.css:178'
  ),
  c(
    'menu/bg',
    'Menu',
    'subtle',
    'open',
    '.c4-menu-surface',
    'background-color',
    root('--rtwiki-floating-bg'),
    'customization.css:178'
  ),
  c(
    'combobox/bg',
    'Combobox',
    'default',
    'open',
    '.c4-combobox-surface',
    'background-color',
    root('--rtwiki-floating-bg'),
    'theme-factory.ts HARDCODED_SURFACE_SLOTS.Combobox'
  )
]

const STATUS_CASES: readonly C4Case[] = [
  c(
    'badge/red-light/bg',
    'Badge',
    'red/light',
    'normal',
    '[data-testid="c4-badge-red-light"]',
    'background-color',
    element('--badge-bg'),
    'component-roles.ts:291 (fixed status)'
  ),
  c(
    'badge/teal-light/bg',
    'Badge',
    'teal/light',
    'normal',
    '[data-testid="c4-badge-teal-light"]',
    'background-color',
    element('--badge-bg'),
    'component-roles.ts:291'
  ),
  c(
    'badge/orange-light/bg',
    'Badge',
    'orange/light',
    'normal',
    '[data-testid="c4-badge-orange-light"]',
    'background-color',
    element('--badge-bg'),
    'component-roles.ts:291'
  ),
  c(
    'alert/red-light/bg',
    'Alert',
    'red/light',
    'normal',
    '[data-testid="c4-alert-red-light"]',
    'background-color',
    element('--alert-bg'),
    'component-roles.ts:291'
  ),
  c(
    'alert/teal-filled/bg',
    'Alert',
    'teal/filled',
    'normal',
    '[data-testid="c4-alert-teal-filled"]',
    'background-color',
    element('--alert-bg'),
    'component-roles.ts:291'
  ),
  c(
    'alert/orange-outline/text',
    'Alert',
    'orange/outline',
    'normal',
    '[data-testid="c4-alert-orange-outline"]',
    'color',
    element('--alert-color'),
    'component-roles.ts:291'
  )
]

function toRequests(cases: readonly C4Case[], tokens: RoleTokens): ReadRequest[] {
  const requests: ReadRequest[] = []
  for (const testCase of cases) {
    const resolved = resolveOracle(testCase, tokens)
    if (!resolved) continue
    requests.push({
      id: testCase.id,
      selector: testCase.selector,
      property: testCase.property,
      pseudo: testCase.pseudo,
      token: resolved.token,
      scope: resolved.scope
    })
  }
  return requests
}

// ---------------------------------------------------------------------------
// C4 — rendered component conformance across all 8 combos
// ---------------------------------------------------------------------------

test.describe('C4 — rendered Mantine component conformance', () => {
  test('every component/variant/state paints its SSoT role across all 8 theme × scheme combinations', async ({
    page,
    request
  }) => {
    test.setTimeout(600_000)
    const failures: Failure[] = []
    let tokens: RoleTokens | null = null
    // Decision 1: status colours are fixed across THEMES, not schemes. Group by
    // scheme and compare every theme's reading with the first theme's.
    const statusReadings = new Map<
      'light' | 'dark',
      Map<string, { themeId: string; value: string }[]>
    >([
      ['light', new Map()],
      ['dark', new Map()]
    ])

    for (const { themeId, scheme } of COMBOS) {
      await setAppearance(request, {
        themeId,
        colorScheme: scheme,
        contrast: 100,
        glassOpacity: 100
      })
      await openShowcase(page)
      const label = `${themeId}/${scheme}`

      // The role table is theme-independent; read it once from the showcase.
      if (tokens === null) {
        const published = await page.evaluate(() => ({
          tokens: window.__C4_ROLE_TOKENS__,
          status: window.__C4_FIXED_STATUS_COLORS__
        }))
        expect(published.tokens, 'showcase must publish the SSoT role table').toBeDefined()
        expect(published.status, 'showcase must publish the fixed status palette').toBeDefined()
        expect(published.status?.length, 'fixed status palette must be non-empty').toBeGreaterThan(
          0
        )
        tokens = published.tokens as unknown as RoleTokens
      }

      // --- Static cases ---
      failures.push(
        ...collectFailures(
          label,
          STATIC_CASES,
          tokens,
          await readBatch(page, toRequests(STATIC_CASES, tokens))
        )
      )

      // --- Status readings (decision 1) ---
      const statusRequests = toRequests(STATUS_CASES, tokens)
      const statusBatch = await readBatch(page, statusRequests)
      for (const reading of statusBatch) {
        const group = statusReadings.get(scheme)
        if (!group) continue
        const list = group.get(reading.id) ?? []
        list.push({ themeId, value: reading.actual })
        group.set(reading.id, list)
      }

      // --- Hover cases ---
      for (const testCase of HOVER_CASES) {
        const target = page.locator(testCase.selector)
        await expect(target, `${label} ${testCase.id} hover target`).toBeVisible()
        await target.hover()
        const [reading] = await readBatch(page, toRequests([testCase], tokens))
        failures.push(...collectFailures(label, [testCase], tokens, [reading]))
        // Move the pointer away so the next hover is not contaminated.
        await page.mouse.move(0, 0)
      }

      // --- Focus cases ---
      for (const testCase of FOCUS_CASES) {
        const target = page.locator(testCase.selector)
        await expect(target, `${label} ${testCase.id} focus target`).toBeVisible()
        await target.focus()
        const [reading] = await readBatch(page, toRequests([testCase], tokens))
        failures.push(...collectFailures(label, [testCase], tokens, [reading]))
        // Record whether the focus ring actually painted (Chromium's
        // :focus-visible heuristic is interaction-dependent, so this is
        // evidence, not a hard assertion — the text-role check above is).
        const focusVisible = await target.evaluate((el) => el.matches(':focus-visible'))
        const outline = await target.evaluate((el) => getComputedStyle(el).outlineColor)
        test.info().annotations.push({
          type: 'c4-focus-evidence',
          description: `${label} ${testCase.id}: focus-visible=${focusVisible} outline=${outline}`
        })
      }

      // --- Floating layers ---
      // Mantine keeps closed dropdowns mounted, so each layer carries a unique
      // class (merged with the theme's rtwiki-floating class) for an unambiguous
      // selector. Each is opened, read, then closed before the next.
      const floatingSteps: ReadonlyArray<{
        id: string
        surface: string
        open: () => Promise<void>
        close: () => Promise<void>
      }> = [
        {
          id: 'popover/bg',
          surface: '.c4-popover-surface',
          open: () => page.getByTestId('c4-popover-trigger').click(),
          // Popover does not reliably close on Escape; an outside click does.
          close: () => page.getByRole('heading', { level: 1 }).click()
        },
        {
          id: 'menu/bg',
          surface: '.c4-menu-surface',
          open: () => page.getByTestId('c4-menu-trigger').click(),
          close: () => page.keyboard.press('Escape')
        },
        {
          id: 'modal/bg',
          surface: '.c4-modal-surface',
          open: () => page.getByTestId('c4-modal-trigger').click(),
          close: () => page.keyboard.press('Escape')
        },
        {
          id: 'combobox/bg',
          surface: '.c4-combobox-surface',
          open: () => page.getByTestId('c4-select-default').click(),
          close: () => page.getByRole('heading', { level: 1 }).click()
        },
        {
          // Tooltip last: its portal can briefly linger after mouseleave, so
          // keeping it last prevents it intercepting any later trigger click.
          id: 'tooltip/bg',
          surface: '.c4-tooltip-surface',
          open: () => page.getByTestId('c4-tooltip-trigger').hover(),
          close: async () => {
            await page.mouse.move(0, 0)
          }
        }
      ]
      for (const step of floatingSteps) {
        await step.open()
        const surface = page.locator(step.surface)
        await expect(surface, `${label} ${step.id} surface must be visible`).toBeVisible({
          timeout: 10_000
        })
        const floatingCase = FLOATING_CASES.find((item) => item.id === step.id)
        if (!floatingCase) throw new Error(`C4: ${step.id} case missing`)
        failures.push(
          ...collectFailures(
            label,
            [floatingCase],
            tokens,
            await readBatch(page, toRequests([floatingCase], tokens))
          )
        )
        await step.close()
        await expect(surface, `${label} ${step.id} surface must close`).toBeHidden({
          timeout: 10_000
        })
      }
    }

    // Decision 1: status colours must be identical across all themes within a
    // scheme. Compare through the gate's colour helper, not raw string equality.
    for (const scheme of ['light', 'dark'] as const) {
      const group = statusReadings.get(scheme)
      if (!group) continue
      for (const [caseId, readings] of group) {
        const reference = readings[0]
        if (!reference) continue
        const mismatches = readings
          .filter((reading) => !compareColor(reading.value, reference.value).ok)
          .map((reading) => `${reading.themeId}=${reading.value}`)
        if (mismatches.length > 0) {
          const testCase = STATUS_CASES.find((item) => item.id === caseId)
          failures.push({
            combo: `${scheme} (cross-theme)`,
            component: testCase?.component ?? caseId,
            variant: testCase?.variant ?? '?',
            state: 'status-fixed',
            property: testCase?.property ?? '?',
            expectedRole: `decision 1: fixed across themes (reference ${reference.themeId}=${reference.value})`,
            expected: reference.value,
            actual: mismatches.join(', '),
            delta: `${mismatches.length} of ${readings.length} themes drifted`,
            source: 'component-roles.ts:291 (FIXED_STATUS_COLORS)'
          })
        }
      }
    }

    // Non-vacuity: the fixed status palette must actually be published and used.
    expect(
      failures.some((f) => f.state === 'status-fixed') === false,
      'status colours must be fixed across themes (decision 1)'
    ).toBe(true)

    expect(failures, formatFailures(failures)).toEqual([])
  })
})
