import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * Images in the Rich editor.
 *
 * Uploads go to RTWiki's own endpoint and are addressed by catalogue id, so
 * these tests also stand as proof the feature needs no network access and no
 * third-party host: the `src` asserted below is always same-origin.
 */

/** A real, valid 1x1 PNG. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
/** SVG that carries script. Detection must refuse it however it is labelled. */
const SVG_WITH_SCRIPT =
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'

function uniqueTitle(base: string): string {
  return `${base} ${Date.now()} ${Math.floor(Math.random() * 1e6)}`
}

async function seedRich(request: APIRequestContext, title: string): Promise<void> {
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
}

async function openNote(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
  await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
}

/** Builds a File in page context and dispatches `paste` carrying it. */
async function pasteFile(
  page: Page,
  name: string,
  mimeType: string,
  base64: string
): Promise<void> {
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
      if (!target) throw new Error('no editor element to paste into')
      target.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
      )
    },
    { name, mimeType, base64 }
  )
}

/** Builds a File in page context and dispatches a drop carrying it. */
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

/** The rendered image inside the editor, once one has been added. */
function editorImage(page: Page) {
  return page.locator('[data-testid="rich-editor"] img')
}

test.describe('images', () => {
  test('an image pasted into a note is stored and rendered', async ({ page, request }) => {
    const title = uniqueTitle('Image Paste')
    await seedRich(request, title)
    await openNote(page, title)

    await pasteFile(page, 'pasted.png', 'image/png', PNG_BASE64)

    const image = editorImage(page).first()
    await expect(image, 'a pasted image must appear in the editor').toBeVisible({
      timeout: 15_000
    })

    // The URL must be a catalogue id, never a filename or a data: URI: a data:
    // URL would put megabytes into the document itself.
    const src = await image.getAttribute('src')
    expect(src).toMatch(/^\/api\/attachments\/[0-9a-f-]{36}$/)

    // And it must actually serve the bytes, at the type the bytes really are.
    const served = await request.get(src as string)
    expect(served.status()).toBe(200)
    expect(served.headers()['content-type']).toBe('image/png')
    expect(served.headers()['x-content-type-options']).toBe('nosniff')
    expect((await served.body()).length).toBeGreaterThan(0)
  })

  test('a dropped image is stored and rendered', async ({ page, request }) => {
    const title = uniqueTitle('Image Drop')
    await seedRich(request, title)
    await openNote(page, title)

    await dropFile(page, 'dropped.png', 'image/png', PNG_BASE64)

    const image = editorImage(page).first()
    await expect(image, 'a dropped image must appear in the editor').toBeVisible({
      timeout: 15_000
    })
    expect(await image.getAttribute('src')).toMatch(/^\/api\/attachments\/[0-9a-f-]{36}$/)
  })

  test('the image survives a save and reload', async ({ page, request }) => {
    const title = uniqueTitle('Image Persist')
    await seedRich(request, title)
    await openNote(page, title)

    await pasteFile(page, 'kept.png', 'image/png', PNG_BASE64)
    const image = editorImage(page).first()
    await expect(image).toBeVisible({ timeout: 15_000 })
    const src = await image.getAttribute('src')

    // Autosave is debounced, so the assertion that matters is the stored page:
    // if the URL is not in the persisted document, the image is lost on reload.
    await expect
      .poll(
        async () => {
          const res = await request.get('/api/pages')
          const body = (await res.json()) as {
            pages: Array<{ title: string; content: string }>
          }
          const page1 = body.pages.find((p) => p.title === title)
          return page1 ? page1.content.includes(src as string) : false
        },
        { timeout: 20_000, message: 'the image URL must be persisted in the page document' }
      )
      .toBe(true)
  })

  test('a script-bearing SVG is refused and explained', async ({ page, request }) => {
    const title = uniqueTitle('Image Reject')
    await seedRich(request, title)
    await openNote(page, title)

    // Labelled as a PNG on purpose: the declared type is exactly what must not
    // decide the outcome.
    await pasteFile(
      page,
      'sneaky.png',
      'image/png',
      Buffer.from(SVG_WITH_SCRIPT, 'utf8').toString('base64')
    )

    // The user has to be told why nothing appeared, rather than left guessing.
    await expect(page.getByText('Image not added')).toBeVisible({ timeout: 15_000 })
    await expect(editorImage(page), 'no image block may be created').toHaveCount(0)
  })

  test('the toolbar image control opens a picker that inserts the chosen file', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Image Picker')
    await seedRich(request, title)
    await openNote(page, title)

    const control = page.getByTestId('insert-image')
    await expect(control, 'the toolbar must offer an image insertion control').toBeVisible()
    await expect(control).toHaveAttribute('aria-label', 'Image')

    // The control opens the OS file dialog; Playwright stands in for the user.
    const chooser = page.waitForEvent('filechooser')
    await control.click()
    const fileChooser = await chooser
    await fileChooser.setFiles({
      name: 'chosen.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_BASE64, 'base64')
    })

    const image = editorImage(page).first()
    await expect(image, 'the chosen image must be inserted').toBeVisible({ timeout: 15_000 })
    expect(await image.getAttribute('src')).toMatch(/^\/api\/attachments\/[0-9a-f-]{36}$/)
  })
})
