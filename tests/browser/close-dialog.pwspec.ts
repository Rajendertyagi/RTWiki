import { expect, type Page, test } from '@playwright/test'

/**
 * In-app close dialog (Tauri shell only).
 *
 * The Rust shell emits `rtwiki:close-request` when the saved close behavior is
 * "ask". These tests inject a minimal native bridge that captures the event
 * listener so the real React dialog can be exercised without a compiled shell.
 * Settings calls go to the real throwaway test server started by Playwright.
 */

async function installBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let callbackId = 0
    const callbacks = new Map<number, (event: unknown) => void>()
    const eventCallbacks = new Map<string, number>()
    const invoked: string[] = []
    ;(window as unknown as { __invoked: string[] }).__invoked = invoked
    ;(window as unknown as { __emitCloseRequest: () => void }).__emitCloseRequest = () => {
      const id = eventCallbacks.get('rtwiki:close-request')
      const cb = id === undefined ? undefined : callbacks.get(id)
      if (cb) cb({ event: 'rtwiki:close-request', payload: null })
    }
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      enumerable: true,
      value: {
        metadata: { currentWindow: { label: 'main' } },
        transformCallback: (callback: unknown) => {
          const id = ++callbackId
          callbacks.set(id, callback as (event: unknown) => void)
          return id
        },
        invoke: (cmd: string, args?: { event?: string; handler?: number }) => {
          invoked.push(cmd)
          if (cmd === 'plugin:event|listen' || cmd === 'plugin:window|listen') {
            if (args?.event && args.handler !== undefined) {
              eventCallbacks.set(args.event, args.handler)
            }
            return Promise.resolve(callbackId)
          }
          return Promise.resolve(undefined)
        }
      }
    })
  })
}

test.describe('In-app close dialog', () => {
  test('shows three actions and a remember checkbox on close request', async ({ page }) => {
    await installBridge(page)
    await page.goto('/')

    await page.evaluate(() => {
      ;(window as unknown as { __emitCloseRequest: () => void }).__emitCloseRequest()
    })

    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Close RTWiki?')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Minimize to tray' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Exit RTWiki' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Remember my choice' })).toBeVisible()
  })

  test('minimize hides the window without saving when remember is unchecked', async ({ page }) => {
    await installBridge(page)
    await page.goto('/')

    await page.evaluate(() => {
      ;(window as unknown as { __emitCloseRequest: () => void }).__emitCloseRequest()
    })
    await page.getByRole('button', { name: 'Minimize to tray' }).click()

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __invoked: string[] }).__invoked))
      .toContain('plugin:window|hide')
    const invoked = await page.evaluate(
      () => (window as unknown as { __invoked: string[] }).__invoked
    )
    expect(invoked).not.toContain('quit_from_dialog')
  })

  test('remember saves the chosen behavior through the settings API', async ({ page }) => {
    await installBridge(page)
    await page.goto('/')

    await page.evaluate(() => {
      ;(window as unknown as { __emitCloseRequest: () => void }).__emitCloseRequest()
    })
    await page.getByRole('checkbox', { name: 'Remember my choice' }).check()
    await page.getByRole('button', { name: 'Minimize to tray' }).click()

    const saved = await page.evaluate(async () => {
      const res = await fetch('/api/settings/desktop')
      return (await res.json()) as { closeBehavior: string; rememberCloseChoice: boolean }
    })
    expect(saved.closeBehavior).toBe('minimize')
  })

  test('cancel dismisses the dialog without acting on the window', async ({ page }) => {
    await installBridge(page)
    await page.goto('/')

    await page.evaluate(() => {
      ;(window as unknown as { __emitCloseRequest: () => void }).__emitCloseRequest()
    })
    await page.getByRole('button', { name: 'Cancel' }).click()

    await expect(page.getByRole('dialog')).toBeHidden()
    const invoked = await page.evaluate(
      () => (window as unknown as { __invoked: string[] }).__invoked
    )
    expect(invoked).not.toContain('plugin:window|hide')
    expect(invoked).not.toContain('quit_from_dialog')
  })
})
