import { expect, type Page, test } from '@playwright/test'

/**
 * Native window-chrome layout contract (Tauri shell only).
 *
 * The desktop shell runs the same web bundle as the browser, so these tests
 * simulate native mode by injecting a minimal `__TAURI_INTERNALS__` bridge
 * before the app boots. That makes `isNativeMode()` true and exercises the
 * real `WindowChrome` render path, including the AppShell geometry it
 * depends on — the class of bug that is invisible in browser mode.
 *
 * The bridge answers the window queries the chrome makes and rejects
 * everything else; `native-bridge.ts` treats rejections as "unavailable", so
 * unrelated desktop features degrade exactly as they do without a shell.
 */

const DESKTOP = { width: 1280, height: 800 }
const TITLE_BAR_HEIGHT = 28
const TAB_STRIP_HEIGHT = 40
const CHROME_HEIGHT = TITLE_BAR_HEIGHT + TAB_STRIP_HEIGHT

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function box(page: Page, selector: string): Promise<Box> {
  const el = page.locator(selector).first()
  await el.waitFor({ state: 'visible' })
  const b = (await el.boundingBox()) as Box
  expect(b, `bounding box for ${selector}`).not.toBeNull()
  return b
}

async function installNativeBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let callbackId = 0
    ;(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } },
      transformCallback: (callback: unknown) => {
        const id = ++callbackId
        ;(window as unknown as Record<string, unknown>)[`_chrome_cb_${id}`] = callback
        return id
      },
      invoke: (cmd: string) => {
        if (cmd === 'plugin:window|is_maximized') return Promise.resolve(false)
        if (cmd === 'plugin:event|listen' || cmd === 'plugin:window|listen') {
          return Promise.resolve(callbackId)
        }
        if (cmd === 'get_close_behavior') return Promise.resolve('minimize')
        return Promise.reject(new Error(`unexpected command in bridge: ${cmd}`))
      }
    }
  })
}

test.describe('Native window chrome', () => {
  test('chrome band is a full-width fixed band of title bar plus tab strip', async ({ page }) => {
    await installNativeBridge(page)
    await page.setViewportSize(DESKTOP)
    await page.goto('/')

    const chrome = await box(page, '[data-testid="window-chrome"]')
    expect(chrome.y).toBeLessThanOrEqual(1)
    expect(Math.round(chrome.height)).toBe(CHROME_HEIGHT)
    expect(Math.round(chrome.width)).toBe(DESKTOP.width)

    // The tab strip lives inside the band, directly under the title bar.
    const tabs = await box(page, '[role="tablist"]')
    expect(tabs.y).toBeGreaterThanOrEqual(TITLE_BAR_HEIGHT - 1)
    expect(tabs.y + tabs.height).toBeLessThanOrEqual(CHROME_HEIGHT + 1)
  })

  test('page never scrolls: the document exactly fits the viewport', async ({ page }) => {
    await installNativeBridge(page)
    await page.setViewportSize(DESKTOP)
    await page.goto('/')

    // The reported symptom was a permanent scrollbar on the right edge that
    // also scrolled the title bar away: chrome in normal flow plus a
    // viewport-sized AppShell.Main overflows the document by the chrome height.
    const overflow = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight
    }))
    expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight + 1)
  })

  test('launcher rail and tree start below the chrome band', async ({ page }) => {
    await installNativeBridge(page)
    await page.setViewportSize(DESKTOP)
    await page.goto('/')

    // Mantine's navbar is fixed at --app-shell-header-offset; without a
    // header that offset is 0 and the rail renders underneath the title bar.
    const rail = await box(page, 'nav[aria-label="RTWiki"]')
    expect(rail.y).toBeGreaterThanOrEqual(CHROME_HEIGHT - 1)
  })

  test('window controls are present and clickable', async ({ page }) => {
    await installNativeBridge(page)
    await page.setViewportSize(DESKTOP)
    await page.goto('/')

    for (const name of ['Minimize window', 'Maximize window', 'Close window']) {
      await expect(page.getByRole('button', { name })).toBeVisible()
    }
  })

  test('control buttons are not descendants of a drag region', async ({ page }) => {
    await installNativeBridge(page)
    await page.setViewportSize(DESKTOP)
    await page.goto('/')

    // Tauri's drag region claims mousedown from the region and its
    // descendants, so a button nested inside one never receives its click.
    // Drag regions must be siblings behind the controls, never their parent.
    const nested = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('[data-testid="window-chrome"] button')).filter(
          (button) => button.closest('[data-tauri-drag-region]') !== null
        ).length
    )
    expect(nested).toBe(0)

    // ...and drag areas still exist for the empty parts of both rows.
    expect(
      await page.locator('[data-testid="window-chrome"] [data-tauri-drag-region]').count()
    ).toBe(2)
  })
})

test.describe('Browser mode', () => {
  test('renders no chrome band and keeps the rail at the viewport top', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await page.goto('/')

    await expect(page.locator('[data-testid="window-chrome"]')).toHaveCount(0)
    const rail = await box(page, 'nav[aria-label="RTWiki"]')
    expect(rail.y).toBeLessThanOrEqual(1)
  })
})
