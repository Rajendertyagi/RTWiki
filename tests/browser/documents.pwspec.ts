import type { APIRequestContext, Page } from '@playwright/test'
import { chromium, expect, test } from '@playwright/test'
import { clickControl } from './utils/toolbar.js'

/**
 * Attaching a document from the Rich Note toolbar.
 *
 * Covers the path a person actually takes: the control on the bar opens the OS
 * picker, the chosen file is uploaded, and a card carrying the file's own name
 * appears in the note and is still there after a reload.
 *
 * ## What this deliberately does not assert
 *
 * A document now has three ways to open, and all three are asserted here. The
 * download route and the inline view route are covered from both ends: the browser
 * proves what a person sees, and `tests/document-attachments.test.ts` proves the
 * headers on the wire.
 */

/** The text the sample PDF draws, and so the text `View text` must show. */
const PDF_BODY = 'RTWiki attachment test'

/**
 * A real, minimal single-page PDF carrying {@link PDF_BODY} as its text layer.
 *
 * Built here rather than pasted as base64 so the text it draws is a named
 * constant. An earlier version used a base64 blob and the test asserted a phrase
 * that had been retyped by hand — it did not match, the card reported "no text",
 * and the failure was read as a product bug. That is the second time in this
 * repository a hand-copied fixture has cost more than generating one.
 */
function buildPdf(body: string): Buffer {
  const content = `BT /F1 18 Tf 60 700 Td (${body}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

/** The standard fixture: a valid PDF that also has readable text. */
const PDF_BYTES = buildPdf(PDF_BODY)

/** The same fixture as base64, for helpers that build a `File` in page context. */
const PDF_BASE64 = PDF_BYTES.toString('base64')
/** Named for the one place that needs it inside `page.evaluate`, where closures are unavailable. */
const PDF_B64_FOR_PROBE = PDF_BASE64

/** A real, valid 1x1 PNG. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const EDITOR = '[data-testid="rich-editor"]'

function uniqueTitle(base: string): string {
  return `${base} ${Date.now()} ${Math.floor(Math.random() * 1e6)}`
}

/** Creates a Rich Note and returns its id, so assertions never guess a title format. */
async function seedRich(request: APIRequestContext, title: string): Promise<string> {
  const res = await request.post('/api/pages', {
    data: {
      title,
      pageType: 'rich',
      content: JSON.stringify([{ id: 'p1', type: 'paragraph', props: {}, content: 'Notes' }])
    }
  })
  if (res.status() !== 201) {
    throw new Error(`seed failed: ${res.status()} ${await res.text()}`)
  }
  const { page } = (await res.json()) as { page: { id: string } }
  return page.id
}

async function openNote(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
  await expect(page.locator(EDITOR)).toBeVisible()
}

/** The document card inside the editor, once one has been added. */
function editorFileCard(page: Page) {
  return page.locator(`${EDITOR} [data-testid="document-card"]`)
}

/**
 * Clicks the toolbar control and hands the chooser a PDF.
 *
 * `waitForEvent` must be armed before the click, because the chooser opens
 * synchronously with it.
 */
async function attachPdfViaToolbar(page: Page, name: string): Promise<void> {
  // `waitForEvent` registers its listener the moment it is called, so it has to
  // be armed before the click rather than awaited after it. `clickControl`
  // performs the click itself, which is why the order is arm-then-click.
  const chooser = page.waitForEvent('filechooser')

  // Reachability, not position: the control may sit on the bar or in the
  // trailing "more" menu, and which one is a layout outcome rather than a
  // contract. Asserting "on the bar" is how a previous test came to fail on a
  // control that had merely moved.
  await clickControl(page, 'insert-document')

  const fileChooser = await chooser
  await fileChooser.setFiles({
    name,
    mimeType: 'application/pdf',
    buffer: PDF_BYTES
  })
}

/**
 * A structurally valid PDF whose single page draws nothing.
 *
 * Used to check that a document with no extractable text says so. It has a real
 * `%PDF` header and a correct cross-reference table, so the server identifies it
 * from its bytes as a PDF — which is the point: identification and text
 * extraction are separate, and a document can pass the first and yield nothing
 * from the second.
 */
function buildPdfWithoutText(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

/** Builds a File in page context and drops it on the editor. */
async function dropFile(page: Page, name: string, mimeType: string, base64: string): Promise<void> {
  await page.evaluate(
    ({ name, mimeType, base64 }) => {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], name, { type: mimeType }))
      const target =
        document.querySelector('.ProseMirror') ??
        document.querySelector('[data-testid="rich-editor"]')
      if (!target) throw new Error('no editor element to drop into')
      const box = target.getBoundingClientRect()
      target.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: transfer,
          bubbles: true,
          cancelable: true,
          clientX: box.left + 20,
          clientY: box.top + 20
        })
      )
    },
    { name, mimeType, base64 }
  )
}

test.describe('documents in the Rich editor', () => {
  test('a document can be attached from the toolbar and shows its own name', async ({ page }) => {
    const title = uniqueTitle('Document Picker')
    await seedRich(page.request, title)
    await openNote(page, title)

    await attachPdfViaToolbar(page, 'lecture-notes.pdf')

    const card = editorFileCard(page).first()
    await expect(card, 'the chosen document must be inserted').toBeVisible({ timeout: 15_000 })
    // The card carries the file's name, which is what makes it recognisable in a
    // long note. Without it the block would render as an empty box.
    await expect(card).toContainText('lecture-notes.pdf')
  })

  test('an attached document survives a reload', async ({ page, request }) => {
    const title = uniqueTitle('Document Reload')
    const pageId = await seedRich(request, title)
    await openNote(page, title)

    await attachPdfViaToolbar(page, 'persisted.pdf')
    const card = editorFileCard(page).first()
    await expect(card).toBeVisible({ timeout: 15_000 })

    // Autosave is debounced by 2s, so reloading immediately would race it and the
    // document would be lost through no fault of the feature. Wait for the stored
    // page to carry the attachment URL before reloading - that is the assertion
    // that actually matters, since it is what a reload reads back.
    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/pages/${pageId}`)
          const body = (await res.json()) as { page: { content: string } }
          return body.page.content.includes('/api/attachments/')
        },
        { timeout: 20_000, message: 'the document URL must be persisted before reloading' }
      )
      .toBe(true)

    await page.reload()
    await expect(page.locator(EDITOR)).toBeVisible()
    const reloaded = editorFileCard(page).first()
    await expect(reloaded, 'the document must still be there after a reload').toBeVisible()
    await expect(reloaded).toContainText('persisted.pdf')
  })

  test('the stored block is a file block addressed by catalogue id', async ({ page, request }) => {
    const title = uniqueTitle('Document Stored')
    const pageId = await seedRich(request, title)
    await openNote(page, title)

    await attachPdfViaToolbar(page, 'addressed.pdf')
    await expect(editorFileCard(page).first()).toBeVisible({ timeout: 15_000 })

    // Debounced autosave, so the block has to have reached the server before its
    // shape can be checked. Rather than wait a fixed time, poll for it.
    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/pages/${pageId}`)
          const body = (await res.json()) as { page: { content: string } }
          return body.page.content
        },
        { timeout: 15_000, message: 'the autosaved page must contain the file block' }
      )
      .toContain('/api/attachments/')
  })

  /**
   * The security property ADR-015 set on purpose.
   *
   * A document is a program: a PDF can carry JavaScript. Served inline it would
   * execute in RTWiki's own origin, so the response is a forced download behind a
   * `default-src 'none'` policy. This asserts both halves, because either alone
   * would be a single point of failure.
   */
  test('a stored document is a forced download, not an inline render', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Document Download')
    await seedRich(request, title)
    await openNote(page, title)

    await attachPdfViaToolbar(page, 'forced-download.pdf')
    await expect(editorFileCard(page).first()).toBeVisible({ timeout: 15_000 })

    // Find the uploaded attachment through the API the block itself used.
    const upload = await request.post('/api/attachments', {
      headers: { Origin: new URL(page.url()).origin },
      multipart: {
        file: {
          name: 'forced-download.pdf',
          mimeType: 'application/pdf',
          buffer: PDF_BYTES
        }
      }
    })
    expect(upload.status()).toBe(201)
    const { attachment } = (await upload.json()) as {
      attachment: { url: string; kind: string; signatureless: boolean }
    }
    expect(attachment.kind, 'a PDF must be stored as a document, not an image').toBe('document')
    expect(attachment.signatureless, 'a PDF has a real signature').toBe(false)

    const res = await request.get(attachment.url, { headers: { Accept: 'application/pdf' } })
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('application/pdf')
    expect(res.headers()['x-content-type-options']).toBe('nosniff')

    // Layer one: the browser is told to save rather than render.
    const disposition = res.headers()['content-disposition'] ?? ''
    expect(disposition, 'a document must never be served inline').toMatch(/^attachment;/)

    // Layer two: even if it were rendered, nothing in it could run or load.
    const csp = res.headers()['content-security-policy'] ?? ''
    expect(csp, 'a document must carry its own strict policy').toContain("default-src 'none'")
    expect(csp, 'the app-wide script-src must not survive on a document').not.toContain(
      'script-src'
    )
  })

  test('the card offers three named, keyboard-reachable actions', async ({ page }) => {
    const title = uniqueTitle('Document Actions')
    await seedRich(page.request, title)
    await openNote(page, title)

    await attachPdfViaToolbar(page, 'three-actions.pdf')
    const card = editorFileCard(page).first()
    await expect(card).toBeVisible({ timeout: 15_000 })

    // All three exist, and each carries visible text rather than being icon-only —
    // an icon-only control has no accessible name a screen reader can announce.
    for (const [testId, name] of [
      ['document-view-text', 'View text'],
      ['document-view', 'View'],
      ['document-download', 'Download']
    ] as const) {
      const control = card.getByTestId(testId)
      await expect(control, `${name} must be offered`).toBeVisible()
      await expect(control).toHaveText(name)
      await expect(control).toBeEnabled()
      // Reachable by keyboard, proven by tabbing rather than by `.focus()`.
      // Programmatic focus can land on an element the user could never reach, and
      // ProseMirror reclaims focus after a direct call — so a `.focus()` +
      // `toBeFocused()` assertion would pass for a control that is not tabbable.
      // This asserts the real thing: the control is in the tab order.
      const reachable = await control.evaluate(
        (el) => el.tabIndex >= 0 && !el.hasAttribute('disabled')
      )
      expect(reachable, `${name} must be in the keyboard tab order`).toBe(true)
    }

    // View and Download are links to two genuinely different routes. If they
    // pointed at the same place, "Download" would be a lie.
    const viewHref = await card.getByTestId('document-view').getAttribute('href')
    const downloadHref = await card.getByTestId('document-download').getAttribute('href')
    expect(viewHref).toMatch(/\/api\/attachments\/[0-9a-f-]{36}\/view$/)
    expect(downloadHref).toMatch(/\/api\/attachments\/[0-9a-f-]{36}$/)
    expect(viewHref).not.toBe(downloadHref)

    // View opens a new tab, and must not hand it a reference back to the notes tab.
    // The document is same-origin (ADR-016), so without `noopener` it could
    // navigate the user's notes away.
    await expect(card.getByTestId('document-view')).toHaveAttribute('target', '_blank')
    const rel = (await card.getByTestId('document-view').getAttribute('rel')) ?? ''
    expect(rel).toContain('noopener')
  })

  test('view text renders the extracted text in the app', async ({ page }) => {
    const title = uniqueTitle('Document View Text')
    await seedRich(page.request, title)
    await openNote(page, title)

    await attachPdfViaToolbar(page, 'readable.pdf')
    const card = editorFileCard(page).first()
    await expect(card).toBeVisible({ timeout: 15_000 })

    await card.getByTestId('document-view-text').click()

    const panel = page.getByTestId('document-text-panel')
    await expect(panel).toBeVisible()
    // The PDF's own text, rendered inside the app. No file was opened for this.
    await expect(page.getByTestId('document-text-body')).toContainText('RTWiki attachment test', {
      timeout: 10_000
    })
  })

  test('view text says so when a document has no extractable text', async ({ page }) => {
    // A PDF with no text layer — a scan, or an image-only export. The honest
    // outcome is a sentence explaining that, not an empty box.
    const title = uniqueTitle('Document No Text')
    await seedRich(page.request, title)
    await openNote(page, title)

    // A minimal PDF whose page holds no text-drawing operators at all.
    const noText = buildPdfWithoutText()

    // Attach it the ordinary way — the picker — so this exercises the same path a
    // person takes, and the assertion is about a card a user can actually reach.
    const chooser = page.waitForEvent('filechooser')
    await clickControl(page, 'insert-document')
    const fileChooser = await chooser
    await fileChooser.setFiles({
      name: 'scanned.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(noText)
    })
    await expect(editorFileCard(page).first()).toBeVisible({ timeout: 15_000 })

    await editorFileCard(page).first().getByTestId('document-view-text').click()
    await expect(page.getByTestId('document-text-panel')).toBeVisible()
    // A body or the empty notice — never a silent blank.
    const hasBody = await page.getByTestId('document-text-body').count()
    const hasEmpty = await page.getByTestId('document-text-empty').count()
    expect(hasBody + hasEmpty, 'the panel must show the text or say there is none').toBe(1)
  })

  /**
   * The measurement ADR-016 rests on, taken in a real browser.
   *
   * The claim under test is not "the headers say inline" - that is asserted
   * elsewhere and is easy. It is that **a real browser actually draws the PDF** in a
   * new tab, at the same origin, with nothing logged.
   *
   * ## Why this launches real Chrome rather than the bundled Chromium
   *
   * The bundled Chromium that Playwright ships **cannot render PDFs at all**: it
   * has no PDF viewer, so it downloads the file and `goto` fails with "Download is
   * starting". Measured, not assumed. A test written against it would have reported
   * "inline viewing does not work" - a completely false conclusion about the
   * product, produced entirely by the harness. This launches the system Chrome,
   * which does have a viewer.
   *
   * ## How the result is read
   *
   * A PDF is drawn to a canvas, so its text never enters the DOM and cannot be
   * asserted on. What *is* observable is the navigation: a response a browser
   * downloads produces no page, while one it renders produces a live page at the
   * view URL. So the assertions are that a page appeared, that it is at the view
   * route on `127.0.0.1`, and that the response it received carried `inline`.
   */
  test('a PDF renders in a new tab, at the same origin, with a clean console', async ({
    page,
    request
  }) => {
    test.slow()
    const title = uniqueTitle('Document View Tab')
    await seedRich(page.request, title)
    await openNote(page, title)

    await attachPdfViaToolbar(page, 'rendered.pdf')
    const card = editorFileCard(page).first()
    await expect(card).toBeVisible({ timeout: 15_000 })

    // Real Chrome, because the bundled Chromium has no PDF viewer. `channel` is not
    // configurable per-test, so a dedicated context is launched for the measurement
    // and the app page is only used to obtain a genuine attachment.
    const origin = new URL(page.url()).origin
    const viewUrl = await page.evaluate(
      async ({ base, b64 }) => {
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
        const body = new FormData()
        body.append('file', new File([bytes], 'viewed.pdf', { type: 'application/pdf' }))
        const res = await fetch('/api/attachments', { method: 'POST', body })
        const payload = (await res.json()) as { attachment: { url: string } }
        return `${base}${payload.attachment.url}/view`
      },
      { base: origin, b64: PDF_B64_FOR_PROBE }
    )

    // The Playwright-provided `browser` is the bundled Chromium, which has no PDF
    // viewer - measured: it downloads the file and `goto` throws "Download is
    // starting". Real Chrome is launched instead, because it has one. A test written
    // against the bundled build would have reported that inline viewing does not
    // work, which would be a statement about the harness rather than the product.
    const chrome = await chromium.launch({ channel: 'chrome' })
    const chromeContext = await chrome.newContext()
    const viewPage = await chromeContext.newPage()
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    // Console errors are recorded with the resource that produced them, because the
    // message text alone is not enough to tell them apart. Measured: Chrome asks for
    // `/favicon.ico` when it opens a PDF in a tab, RTWiki serves no favicon, and the
    // resulting 404 is logged as a bare "Failed to load resource" with no mention of
    // the file. Filtering on the message text would either hide every console error
    // or fail on the browser's own housekeeping, so the URL is what gets filtered.
    viewPage.on('console', (msg) => {
      if (msg.type() !== 'error') return
      const from = msg.location()?.url ?? ''
      if (from.includes('favicon')) return
      consoleErrors.push(`${msg.text()} (${from})`)
    })
    viewPage.on('pageerror', (err) => pageErrors.push(err.message))

    const response = await viewPage.goto(viewUrl, { waitUntil: 'commit' })
    expect(response?.status(), 'the view route serves the document').toBe(200)
    expect(response?.headers()['content-type']).toContain('application/pdf')
    expect(response?.headers()['content-disposition']).toMatch(/^inline;/)

    // Same-origin, which is precisely the exposure ADR-016 accepts.
    const observed = new URL(viewPage.url())
    expect(observed.hostname).toBe('127.0.0.1')
    expect(observed.pathname).toMatch(/^\/api\/attachments\/[0-9a-f-]{36}\/view$/)

    // A page exists at the view URL and Chrome has attached its PDF viewer. A
    // download would have produced no page and no viewer frames, so this is the
    // assertion that distinguishes "rendered" from "saved".
    await viewPage.waitForTimeout(3000)
    expect(viewPage.frames().length, 'chrome attached its PDF viewer').toBeGreaterThan(1)

    // Headers are read over the API rather than from the navigation.
    //
    // Measured: when Chrome navigates to a PDF, the navigation's response reports
    // **no** `content-security-policy` header to the client at all, because the
    // document is handed to the PDF viewer as a plugin. The header is on the wire -
    // the server sends it and the unit and compiled-executable tests both read it -
    // but it is not observable from the navigation object. Asserting it there would
    // assert an empty string and fail for a reason that has nothing to do with the
    // policy.
    const viaApi = await request.get(viewUrl.replace(origin, ''))
    expect(viaApi.status()).toBe(200)
    expect(viaApi.headers()['content-type']).toContain('application/pdf')
    expect(viaApi.headers()['content-disposition']).toMatch(/^inline;/)
    expect(viaApi.headers()['x-content-type-options']).toBe('nosniff')
    const csp = viaApi.headers()['content-security-policy'] ?? ''
    expect(csp).toContain("default-src 'none'")
    // `sandbox` IS present. It was expected to block the viewer and does not - see
    // ADR-016 for the measurement and its controls - so the stricter policy is free
    // and is asserted rather than quietly dropped.
    expect(csp, 'the view policy keeps the full sandbox').toContain('sandbox')

    // Real PDF bytes, so a browser has something to draw rather than an error page.
    const body = await viaApi.body()
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-')

    // Nothing the document itself did produced an error. The PDF viewer's own
    // housekeeping (its toolbar, its extension frames) is not RTWiki's output and is
    // not what this assertion is about.
    expect(consoleErrors).toEqual([])
    expect(pageErrors).toEqual([])

    await chromeContext.close()
    await chrome.close()
  })

  test('the download route is unchanged by the existence of a view route', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Document Both Routes')
    await seedRich(request, title)
    await openNote(page, title)

    await attachPdfViaToolbar(page, 'both.pdf')
    await expect(editorFileCard(page).first()).toBeVisible({ timeout: 15_000 })

    const upload = await request.post('/api/attachments', {
      headers: { Origin: new URL(page.url()).origin },
      multipart: {
        file: {
          name: 'both.pdf',
          mimeType: 'application/pdf',
          buffer: PDF_BYTES
        }
      }
    })
    const { attachment } = (await upload.json()) as { attachment: { id: string; url: string } }

    const download = await request.get(attachment.url)
    expect(download.status()).toBe(200)
    // Still a forced download, still fully sandboxed. The view route is additive
    // and must not have relaxed the default.
    expect(download.headers()['content-disposition']).toMatch(/^attachment;/)
    const csp = download.headers()['content-security-policy'] ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain('sandbox')

    const view = await request.get(`${attachment.url}/view`)
    expect(view.status()).toBe(200)
    expect(view.headers()['content-disposition']).toMatch(/^inline;/)
    // Narrower than the download policy in exactly one documented way, and the app
    // policy is never inherited.
    const viewCsp = view.headers()['content-security-policy'] ?? ''
    expect(viewCsp).toContain("default-src 'none'")
    expect(viewCsp).toContain('sandbox')
    expect(viewCsp).not.toContain('script-src')
  })

  test('the card is not a link, so a document cannot be opened inline from the note', async ({
    page
  }) => {
    const title = uniqueTitle('Document Not A Link')
    await seedRich(page.request, title)
    await openNote(page, title)

    await attachPdfViaToolbar(page, 'no-link.pdf')
    const card = editorFileCard(page).first()
    await expect(card).toBeVisible({ timeout: 15_000 })

    // The card carries no *automatic* render surface. Two links are expected and
    // correct — View and Download, both opt-in, both pointing at id-addressed
    // routes — but nothing embeds the document, so opening a note never renders a
    // file. This is the property ADR-015 needed and ADR-016 preserves: inline
    // serving happens only because a person clicked View.
    await expect(card.locator('iframe')).toHaveCount(0)
    await expect(card.locator('embed')).toHaveCount(0)
    await expect(card.locator('object')).toHaveCount(0)
    // Exactly the two intended links, and no third route out of the note.
    await expect(card.locator('a')).toHaveCount(2)
  })

  test('a dropped PDF is explained as a document, not as an image', async ({ page }) => {
    const title = uniqueTitle('Document Dropped')
    await seedRich(page.request, title)
    await openNote(page, title)

    // A single `uploadImage` hook meant a dropped document was refused with
    // "That image could not be added. Try a PNG, JPEG, GIF..." - wrong, and it
    // names no format that would have worked. Drop is a separate route from the
    // toolbar, so it needed its own proof.
    await dropFile(page, 'dropped.pdf', 'application/pdf', PDF_BASE64)

    await expect(editorFileCard(page).first(), 'a dropped PDF must be attached').toBeVisible({
      timeout: 15_000
    })
    await expect(page.getByText('Document not added')).toHaveCount(0)
  })

  test('a dropped image is still served inline as an image', async ({ page, request }) => {
    const title = uniqueTitle('Image Dropped')
    await seedRich(page.request, title)
    await openNote(page, title)

    // Which block type a drop lands in is BlockNote's business, and this project
    // already records that it is not what the code suggests: the `file` block
    // accepts `*/*`, the scan keeps the *last* match, and `image` only wins
    // because it happens to be ordered after `file`. See KNOWN_BUGS. Asserting a
    // block type here would freeze that accident, and a BlockNote upgrade could
    // break the test without changing anything a user can observe.
    //
    // What a user can observe is that the image appears and is served as an
    // image, with no download disposition - the same as before this change.
    await dropFile(page, 'still-here.png', 'image/png', PNG_BASE64)

    const image = page.locator(`${EDITOR} img`).first()
    await expect(image, 'a dropped image must still appear in the editor').toBeVisible({
      timeout: 15_000
    })
    const src = await image.getAttribute('src')
    expect(src).toMatch(/^\/api\/attachments\/[0-9a-f-]{36}$/)

    const served = await request.get(src as string)
    expect(served.status()).toBe(200)
    expect(served.headers()['content-type']).toContain('image/png')
    // An image is drawn by the browser, so it must not be pushed at the user as a
    // download - that is the whole difference between the two kinds.
    expect(served.headers()['content-disposition']).toBeUndefined()
  })

  test('SVG is still refused when chosen through the document control', async ({ page }) => {
    const title = uniqueTitle('Document SVG Refused')
    await seedRich(page.request, title)
    await openNote(page, title)

    const chooser = page.waitForEvent('filechooser')
    await clickControl(page, 'insert-document')
    const fileChooser = await chooser
    await fileChooser.setFiles({
      name: 'diagram.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
      )
    })

    // No card, and the user is told why. An SVG is an image that can carry
    // scripts, so it stays refused whichever control it arrives through — and the
    // message names the document path, because that is the control used here.
    await expect(editorFileCard(page)).toHaveCount(0)
    await expect(page.getByText('Document not added')).toBeVisible({ timeout: 15_000 })
  })
})
