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
/** LAYOUT.chromeBandHeight — the single band that holds tabs + window controls. */
const CHROME_BAND_HEIGHT = 40

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

async function installNativeBridge(page: Page, options: { closeBehavior?: 'ok' | 'reject' } = {}) {
  const closeBehavior = options.closeBehavior ?? 'ok'
  await page.addInitScript((mode) => {
    let callbackId = 0
    const invoked: string[] = []
    ;(window as unknown as { __invoked: string[] }).__invoked = invoked
    ;(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } },
      transformCallback: (callback: unknown) => {
        const id = ++callbackId
        ;(window as unknown as Record<string, unknown>)[`_chrome_cb_${id}`] = callback
        return id
      },
      invoke: (cmd: string) => {
        invoked.push(cmd)
        if (cmd === 'plugin:window|is_maximized') return Promise.resolve(false)
        if (cmd === 'plugin:event|listen' || cmd === 'plugin:window|listen') {
          return Promise.resolve(callbackId)
        }
        if (cmd === 'get_close_behavior') {
          return mode === 'reject'
            ? Promise.reject(new Error('desktop.json unreadable'))
            : Promise.resolve('minimize')
        }
        return Promise.resolve(undefined)
      }
    }
  }, closeBehavior)
}

test.describe('Native window chrome', () => {
  test('chrome band is a full-width fixed band of title bar plus tab strip', async ({ page }) => {
    await installNativeBridge(page)
    await page.setViewportSize(DESKTOP)
    await page.goto('/')

    const chrome = await box(page, '[data-testid="window-chrome"]')
    expect(chrome.y).toBeLessThanOrEqual(1)
    expect(Math.round(chrome.height)).toBe(CHROME_BAND_HEIGHT)

    // The band is a single row: the tab strip IS the top bar, and the window
    // controls overlay its right end (reserved, not on a second row).
    const tabs = await box(page, '[role="tablist"]')
    expect(tabs.y).toBeLessThanOrEqual(chrome.y + 1)
    expect(tabs.y + tabs.height).toBeLessThanOrEqual(chrome.y + chrome.height + 1)

    // Tabs stop before the caption controls instead of running underneath them.
    const close = await box(page, '[aria-label="Close window"]')
    expect(tabs.x + tabs.width).toBeLessThanOrEqual(close.x + 1)

    // The band begins beside the tree, not above it.
    const rail = await box(page, 'nav[aria-label="RTWiki"]')
    expect(chrome.x).toBeGreaterThanOrEqual(rail.x + rail.width - 1)
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

  test('launcher rail and page tree run the full window height', async ({ page }) => {
    await installNativeBridge(page)
    await page.setViewportSize(DESKTOP)
    await page.goto('/')

    // `layout="alt"`: the navbar spans the full viewport height, so the rail and
    // the tree column beside it reach the very top instead of starting under a
    // chrome row. The tree *widget* legitimately sits lower — the sidebar owns
    // a search field above it — so the pane column is what is asserted here.
    const panes = await page.evaluate(() => {
      const rail = document.querySelector('nav[aria-label="RTWiki"]') as HTMLElement
      // nav.rail sits inside the rail column, which is a child of the navbar inner.
      const railColumn = rail.parentElement as HTMLElement
      const navbarInner = railColumn.parentElement as HTMLElement
      const treeColumn = railColumn.nextElementSibling as HTMLElement | null
      const railRect = rail.getBoundingClientRect()
      const treeRect = treeColumn?.getBoundingClientRect()
      return {
        navbarY: Math.round(navbarInner.getBoundingClientRect().y),
        railY: Math.round(railRect.y),
        railBottom: Math.round(railRect.bottom),
        treeColumnY: treeRect ? Math.round(treeRect.y) : null,
        treeColumnBottom: treeRect ? Math.round(treeRect.bottom) : null
      }
    })

    expect(panes.navbarY).toBeLessThanOrEqual(1)
    expect(panes.railY).toBeLessThanOrEqual(1)
    expect(panes.railBottom).toBeGreaterThanOrEqual(DESKTOP.height - 1)
    expect(panes.treeColumnY).toBeLessThanOrEqual(1)
    expect(panes.treeColumnBottom).toBeGreaterThanOrEqual(DESKTOP.height - 1)
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

    // ...and a drag area still exists behind the row for its empty parts.
    expect(
      await page.locator('[data-testid="window-chrome"] [data-tauri-drag-region]').count()
    ).toBe(1)
  })

  test('close falls back to the shell when the behaviour read fails', async ({ page }) => {
    // The setting is read from disk by a Tauri command, so it can fail. The
    // shell's CloseRequested handler re-reads the same setting, so deferring to
    // it is always a valid answer — the button must never become a dead control.
    await installNativeBridge(page, { closeBehavior: 'reject' })
    await page.setViewportSize(DESKTOP)
    await page.goto('/')

    await page.getByRole('button', { name: 'Close window' }).click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __invoked: string[] }).__invoked))
      .toContain('plugin:window|close')
  })

  test('the band has exactly one separator and no doubled border', async ({ page }) => {
    await installNativeBridge(page)
    await page.setViewportSize(DESKTOP)
    await page.goto('/')

    // The band owns the single bottom separator; the tab strip inside it must
    // not add a second one (a transparent border would still cost 1px of the
    // band's height and clip the strip).
    const borders = await page.evaluate(() => {
      const band = document.querySelector('[data-testid="window-chrome"]') as HTMLElement
      const tablist = band.querySelector('[role="tablist"]')
      // tablist sits directly inside the strip row.
      const strip = tablist?.parentElement as HTMLElement | null
      return {
        band: getComputedStyle(band).borderBottomWidth,
        strip: strip ? getComputedStyle(strip).borderBottomWidth : 'missing'
      }
    })
    expect(borders.band).toBe('1px')
    expect(borders.strip).toBe('0px')
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
