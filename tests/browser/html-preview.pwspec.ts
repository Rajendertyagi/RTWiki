import {
  type APIRequestContext,
  expect,
  type Frame,
  type Page,
  test
} from '@playwright/test'

/**
 * Real-Chromium security suite for sandboxed HTML previews (Phase 4A).
 *
 * String/unit tests cannot prove CSP or sandbox enforcement, so every
 * security property below is exercised in a real browser against the real
 * built application. Probes run INSIDE the seeded JavaScript pane (which is
 * itself nonce'd), recording outcomes and `securitypolicyviolation` events
 * into the frame's own DOM — no test-injected script bypasses page policies.
 */

const PREVIEW_FRAME = '[data-testid="preview-iframe"]'
const PREVIEW_ROOT = '[data-testid="html-preview"]'
const RUNTIME_ISSUE_TEXT = 'The preview reported a problem'

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

interface SeedOptions {
  html?: string
  css?: string
  javascript?: string
}

async function seedHtmlPage(
  request: APIRequestContext,
  title: string,
  options: SeedOptions = {}
): Promise<void> {
  const content = JSON.stringify({
    version: 1,
    html: options.html ?? '<p id="seed-body">seed body</p>',
    css: options.css ?? '',
    javascript: options.javascript ?? ''
  })
  const res = await request.post('/api/pages', {
    data: { title, pageType: 'html', content }
  })
  expect(res.status(), 'seed page should be created').toBe(201)
}

async function readStoredContent(
  request: APIRequestContext,
  title: string
): Promise<string | undefined> {
  const res = await request.get('/api/pages')
  const list = (await res.json()) as { pages: Array<{ title: string; content: string }> }
  return list.pages.find((p) => p.title === title)?.content
}

/**
 * Message recorder installed on the application window BEFORE the preview
 * opens, so the bootstrap's very first message is never missed.
 */
type AppWindow = Window & {
  __msgs?: string[]
  __violations?: string[]
}

async function installMessageRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as AppWindow
    w.__msgs = []
    window.addEventListener('message', (event) => {
      const data = event.data as { type?: unknown; operation?: unknown; channel?: unknown } | null
      if (data && typeof data === 'object') {
        w.__msgs!.push(
          `${String(data.type)}|${String(data.operation ?? '')}|${String(data.channel ?? '')}`
        )
      }
    })
  })
}

async function readMessages(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as AppWindow).__msgs ?? [])
}

/** Navigates home, records messages, then opens the seeded page. */
async function openWithRecorder(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await installMessageRecorder(page)
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
  await expect(page.locator(PREVIEW_FRAME)).toBeVisible()
}

async function openPlain(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
  await expect(page.locator(PREVIEW_FRAME)).toBeVisible()
}

/** Waits until the preview's bootstrap posted its ready message. */
async function awaitPreviewReady(page: Page): Promise<void> {
  await expect(page.locator(PREVIEW_ROOT)).toHaveAttribute('data-preview-status', 'ready')
}

function srcdocFrame(page: Page): Frame {
  const frame = page.frames().find((f) => f.url() === 'about:srcdoc')
  if (!frame) {
    throw new Error('srcdoc preview frame not found')
  }
  return frame
}

async function readViolations(page: Page): Promise<string[]> {
  return srcdocFrame(page).evaluate(() => (window as AppWindow).__violations ?? [])
}

async function waitForViolation(
  page: Page,
  directivePrefix: string,
  description: string
): Promise<string> {
  let matched = ''
  await expect
    .poll(
      async () => {
        const violations = await readViolations(page)
        matched =
          violations.find((v) => v.startsWith(`${directivePrefix}|`)) ??
          violations.find((v) => v.startsWith(directivePrefix)) ??
          ''
        return matched
      },
      { timeout: 10_000, message: `expected a ${description} CSP violation` }
    )
    .not.toBe('')
  return matched
}

/**
 * Probe program executed by the nonce'd JavaScript pane. Every risky action
 * is wrapped so nothing escapes as an uncaught exception; outcomes land in
 * frame-DOM attributes and the violations array.
 */
const PROBE_JS = [
  'window.__violations = [];',
  "document.addEventListener('securitypolicyviolation', function (e) {",
  "  window.__violations.push((e.violatedDirective || '?') + '|' + (e.blockedURL || ''));",
  '});',
  'function mark(key, value) { document.documentElement.setAttribute("data-" + key, value); }',
  'mark("js", "ran");',
  'try {',
  '  eval("window.__evaled = true");',
  '  mark("eval", window.__evaled ? "ran" : "blocked");',
  '} catch (e) { mark("eval", "blocked:" + e.name); }',
  'var extScript = document.createElement("script");',
  'extScript.src = "https://external-probe.invalid/x.js";',
  'document.head.appendChild(extScript);',
  'fetch("https://external-probe.invalid/data").then(',
  '  function () { mark("fetch", "allowed"); },',
  '  function () { mark("fetch", "blocked"); }',
  ');',
  'try {',
  '  var ws = new WebSocket("wss://external-probe.invalid/ws");',
  '  ws.onopen = function () { mark("ws", "allowed"); };',
  '  ws.onerror = function () { mark("ws", "blocked"); };',
  '  ws.onclose = function () { if (!document.documentElement.hasAttribute("data-ws")) mark("ws", "blocked"); };',
  '} catch (e) { mark("ws", "blocked:" + e.name); }',
  'var nested = document.createElement("iframe");',
  'nested.src = "https://external-probe.invalid/frame";',
  'document.body.appendChild(nested);',
  'var unnonced = document.createElement("script");',
  'unnonced.textContent = \'mark("unnonced", "ran")\';',
  'document.body.appendChild(unnonced);',
  'setTimeout(function () {',
  '  if (!document.documentElement.hasAttribute("data-unnonced")) mark("unnonced", "blocked");',
  '}, 300);'
].join('\n')

test.describe('HTML preview security (real Chromium)', () => {
  let pageErrors: Error[] = []

  test.beforeEach(({ page }) => {
    pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(err))
  })

  test.afterEach(() => {
    // The main application must never throw; sandbox-internal failures are
    // contained by design and surface through the reporter instead.
    expect(pageErrors, 'no uncaught exceptions in the application').toEqual([])
  })

  // --- Nonce infrastructure ---

  test('parent CSP header and served HTML carry the same per-response nonce', async ({
    request
  }) => {
    const res = await request.get('/')
    expect(res.status()).toBe(200)
    const csp = res.headers()['content-security-policy'] ?? ''
    const headerNonce = /script-src[^;]*'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1] ?? null
    expect(headerNonce).not.toBeNull()

    const html = await res.text()
    const metaNonce =
      /<meta name="rtwiki-preview-nonce" content="([A-Za-z0-9+/=]+)">/.exec(html)?.[1] ?? null
    expect(metaNonce).toBe(headerNonce)
  })

  test('separate HTML responses receive different nonces', async ({ request }) => {
    const first = await request.get('/')
    const second = await request.get('/')
    const nonceA = /'nonce-([A-Za-z0-9+/=]+)'/.exec(first.headers()['content-security-policy'] ?? '')
      ?.[1]
    const nonceB = /'nonce-([A-Za-z0-9+/=]+)'/.exec(second.headers()['content-security-policy'] ?? '')
      ?.[1]
    expect(nonceA).toBeTruthy()
    expect(nonceB).toBeTruthy()
    expect(nonceA).not.toBe(nonceB)
  })

  test('SPA fallback responses also pair header and meta nonce', async ({ request }) => {
    const res = await request.get('/pages/some/route')
    expect(res.status()).toBe(200)
    const csp = res.headers()['content-security-policy'] ?? ''
    const headerNonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1] ?? null
    const html = await res.text()
    const metaNonce =
      /<meta name="rtwiki-preview-nonce" content="([A-Za-z0-9+/=]+)">/.exec(html)?.[1] ?? null
    expect(metaNonce).toBe(headerNonce)
  })

  test('application CSP never introduces unsafe-inline scripts, unsafe-eval or blob:', async ({
    request
  }) => {
    const res = await request.get('/')
    const csp = res.headers()['content-security-policy'] ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).toMatch(/script-src[^;]*'nonce-/)
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(csp).not.toContain("'unsafe-eval'")
    expect(csp).not.toContain('blob:')
    expect(csp).toContain("frame-ancestors 'none'")
  })

  // --- Execution and normalization ---

  test('JavaScript-pane code executes inside the sandbox', async ({ page, request }) => {
    const title = uniqueTitle('JS Exec')
    await seedHtmlPage(request, title, { javascript: PROBE_JS })
    await openPlain(page, title)

    const frame = page.frameLocator(PREVIEW_FRAME)
    await expect(frame.locator('html[data-js="ran"]')).toBeAttached()
  })

  test('HTML-pane scripts are stripped from the preview and never execute', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Html Script')
    const smuggledScript = '<script>window.__htmlPaneRan = true;</script>'
    await seedHtmlPage(request, title, {
      html: `<p>before</p>${smuggledScript}<p id="after-marker">after</p>`
    })
    await openPlain(page, title)

    const frame = page.frameLocator(PREVIEW_FRAME)
    await expect(frame.locator('#after-marker')).toBeVisible()
    await expect(frame.locator('script')).toHaveCount(0)

    // Stored source remains exactly what was authored.
    const stored = await readStoredContent(request, title)
    expect(stored).toContain(smuggledScript)
  })

  test('inline event handlers never execute', async ({ page, request }) => {
    const title = uniqueTitle('Inline Handler')
    await seedHtmlPage(request, title, {
      html: `<button onclick="document.documentElement.setAttribute('data-handler','ran')">go</button>`,
      javascript: PROBE_JS
    })
    await openPlain(page, title)
    await awaitPreviewReady(page)

    const frame = page.frameLocator(PREVIEW_FRAME)
    await frame.locator('button').click()
    await expect(frame.locator('html[data-handler="ran"]')).toHaveCount(0)
  })

  // --- Platform enforcement probes ---

  test('eval is blocked despite being attempted from the executing JS pane', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Eval Blocked')
    await seedHtmlPage(request, title, { javascript: PROBE_JS })
    await openPlain(page, title)

    const frame = page.frameLocator(PREVIEW_FRAME)
    await expect(frame.locator('html[data-eval^="blocked"]')).toBeAttached()
  })

  test('dynamically injected unnonced inline script is blocked', async ({ page, request }) => {
    const title = uniqueTitle('Unnonced Script')
    await seedHtmlPage(request, title, { javascript: PROBE_JS })
    await openPlain(page, title)

    const frame = page.frameLocator(PREVIEW_FRAME)
    await expect(frame.locator('html[data-unnonced="blocked"]')).toBeAttached({ timeout: 10_000 })
    await waitForViolation(page, 'script-src', 'unnonced inline script')
  })

  test('external script loading is blocked', async ({ page, request }) => {
    const title = uniqueTitle('External Script')
    await seedHtmlPage(request, title, { javascript: PROBE_JS })
    await openPlain(page, title)

    await waitForViolation(page, 'script-src', 'external script')
  })

  test('fetch requests are blocked', async ({ page, request }) => {
    const title = uniqueTitle('Fetch Blocked')
    await seedHtmlPage(request, title, { javascript: PROBE_JS })
    await openPlain(page, title)

    const frame = page.frameLocator(PREVIEW_FRAME)
    await expect(frame.locator('html[data-fetch="blocked"]')).toBeAttached()
    await waitForViolation(page, 'connect-src', 'fetch')
  })

  test('WebSocket connections are blocked', async ({ page, request }) => {
    const title = uniqueTitle('Ws Blocked')
    await seedHtmlPage(request, title, { javascript: PROBE_JS })
    await openPlain(page, title)

    const frame = page.frameLocator(PREVIEW_FRAME)
    await expect(frame.locator('html[data-ws^="blocked"]')).toBeAttached()
    await waitForViolation(page, 'connect-src', 'websocket')
  })

  test('nested frames are blocked', async ({ page, request }) => {
    const title = uniqueTitle('Nested Frame')
    await seedHtmlPage(request, title, { javascript: PROBE_JS })
    await openPlain(page, title)

    await waitForViolation(page, 'frame-src', 'nested frame')
  })

  // --- Navigation and messaging ---

  test('form submission is blocked and reported over the approved channel', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Form Block')
    await seedHtmlPage(request, title, {
      html: '<form action="https://external-probe.invalid/submit"><input name="q"><button type="submit">send</button></form>'
    })
    await openWithRecorder(page, title)
    await awaitPreviewReady(page)

    const frame = page.frameLocator(PREVIEW_FRAME)
    await frame.locator('button[type="submit"]').click()

    // The frame must not navigate away.
    await expect(frame.locator('form')).toBeVisible()
    const msgs = await readMessages(page)
    expect(msgs.some((m) => m.startsWith('rtwiki-preview-error|form-submission|'))).toBe(true)
  })

  test('anchor navigation is blocked and top-level navigation never occurs', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Anchor Block')
    await seedHtmlPage(request, title, {
      html: '<a href="https://external-probe.invalid/page" target="_top">leave</a><p id="stay-marker">stay here</p>'
    })
    await openWithRecorder(page, title)
    await awaitPreviewReady(page)

    const urlBefore = page.url()
    const frame = page.frameLocator(PREVIEW_FRAME)
    await frame.locator('a').click()

    await expect(frame.locator('#stay-marker')).toBeVisible()
    expect(page.url()).toBe(urlBefore)
    const msgs = await readMessages(page)
    expect(msgs.some((m) => m.startsWith('rtwiki-preview-error|anchor-navigation|'))).toBe(true)
  })

  test('sandbox attribute is exactly allow-scripts with srcdoc delivery', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Sandbox Attr')
    await seedHtmlPage(request, title)
    await openPlain(page, title)

    const iframe = page.locator(PREVIEW_FRAME)
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
    const srcdoc = await iframe.getAttribute('srcdoc')
    expect(srcdoc).toBeTruthy()
    expect(srcdoc).toContain('Content-Security-Policy')
  })

  test('valid current-channel message accepted; wrong channel and spoofed source rejected', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Channel Checks')
    await seedHtmlPage(request, title, { javascript: PROBE_JS })
    await openWithRecorder(page, title)
    await awaitPreviewReady(page) // valid current-channel acceptance

    const msgs = await readMessages(page)
    const readyEntry = msgs.find((m) => m.startsWith('rtwiki-preview-ready|'))
    expect(readyEntry).toBeTruthy()
    const channel = readyEntry!.split('|')[2]

    // Posted from INSIDE the frame (correct source): wrong channel rejected…
    await srcdocFrame(page).evaluate(() => {
      parent.postMessage(
        { type: 'rtwiki-preview-error', channel: 'f'.repeat(32), operation: 'wrong-channel' },
        '*'
      )
    })
    // …and stale channel rejected (the id from before any rebuild).
    await srcdocFrame(page).evaluate((ch) => {
      parent.postMessage(
        { type: 'rtwiki-preview-error', channel: ch, operation: 'stale-channel' },
        '*'
      )
    }, channel)

    // Spoofed SOURCE: correct channel but dispatched from the parent window.
    await page.evaluate((ch) => {
      window.postMessage(
        { type: 'rtwiki-preview-error', channel: ch, operation: 'source-spoof' },
        window.location.origin
      )
    }, channel)

    await page.waitForTimeout(500)
    await expect(page.locator(PREVIEW_ROOT)).toHaveAttribute('data-preview-status', 'ready')
    await expect(page.getByText(RUNTIME_ISSUE_TEXT)).toHaveCount(0)
  })

  test('runtime errors surface as sanitized status without leaking content', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Runtime Error')
    await seedHtmlPage(request, title, {
      // Synthetic ErrorEvent exercises the real reporting path without an
      // uncaught exception leaking into the application-level pageerror log.
      javascript:
        'window.dispatchEvent(new ErrorEvent("error", { error: new TypeError("probe") }));'
    })
    await openWithRecorder(page, title)

    await expect(page.locator(PREVIEW_ROOT)).toHaveAttribute(
      'data-preview-status',
      'runtime-issue'
    )
    await expect(page.getByText(RUNTIME_ISSUE_TEXT)).toBeVisible()

    const msgs = await readMessages(page)
    const errorEntry = msgs.find((m) => m.includes('|runtime|'))
    expect(errorEntry).toBeTruthy()
    // Sanitized: error name only, plus the channel id — never page content.
    expect(errorEntry).toMatch(/\|runtime\|[0-9a-f]{32}$/)
  })

  test('missing nonce fails closed with recovery UI and a sanitized log entry', async ({
    page,
    request
  }) => {
    const clientErrorPayloads: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/api/client-errors')) {
        clientErrorPayloads.push(req.postData() ?? '')
      }
    })

    const title = uniqueTitle('No Nonce')
    await seedHtmlPage(request, title)

    // Strip the nonce meta from the served document: the app must fail
    // closed instead of building a preview that could not execute.
    await page.route('/', async (route) => {
      const response = await route.fetch()
      const body = await response.text()
      const stripped = body.replace(/<meta name="rtwiki-preview-nonce"[^>]*>/, '')
      await route.fulfill({ response, body: stripped })
    })

    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()

    // Recovery UI appears; the rest of RTWiki stays intact.
    await expect(page.getByText('Preview unavailable')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
    await expect(page.locator(PREVIEW_FRAME)).toHaveCount(0)

    // A sanitized report reached the diagnostics endpoint.
    await expect
      .poll(() => clientErrorPayloads.some((p) => p.includes('html_preview_error')), {
        timeout: 10_000
      })
      .toBe(true)
    const report = clientErrorPayloads.find((p) => p.includes('html_preview_error')) ?? ''
    const parsed = JSON.parse(report) as Record<string, unknown>
    expect(parsed.errorMessage).toBe('Building the sandboxed HTML preview failed.')
    // Never the page title or content.
    expect(report).not.toContain(title)
    expect(report).not.toContain('seed body')
  })
})
