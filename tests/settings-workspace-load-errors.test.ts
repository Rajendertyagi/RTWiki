import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { UI_TEXT } from '../src/web/config/index.js'
import {
  clearDebugLogView,
  setDebugLoggingEnabled,
  setDebugLogStorageForTests
} from '../src/web/diagnostics/debug-log.js'
import { defaultLayoutPreferences } from '../src/web/features/workspace/layout-preferences.js'
import type {
  DesktopSettings,
  ServerPortSettings
} from '../src/web/services/server-settings-api.js'
import { sharedDom } from './utils/dom-harness.js'

/**
 * A failed settings read used to be swallowed.
 *
 * `SettingsWorkspace` mounted with two `.catch(() => {})` handlers, one per
 * read. When a read failed the panel kept rendering its fallback values — an
 * **empty** port field, `closeBehavior: 'ask'` — with nothing on screen to say
 * so. A user could not tell a real value from a placeholder, and the port field
 * in particular looked editable while reflecting nothing: someone who believed
 * it was showing their port could save over one they were never shown.
 *
 * ## What these tests assert, and why they assert it that way
 *
 * The defect was in the wiring between a rejected read and what the user sees,
 * so a dictionary assertion would have passed while the panel stayed silent.
 * These mount the real component in jsdom and break each read for real.
 *
 * The two reads are **independent** — separate endpoints, separate files
 * (`data/server.json` and `data/desktop.json`) — so each is broken on its own
 * and the other's values are asserted to survive. A single shared error flag
 * would pass a "both fail" test while still blanking the panel whenever only
 * one of them broke, which is the more common case.
 *
 * ## Why the DOM is the shared one, and never closed
 *
 * `utils/dom-harness.ts` owns one process-wide DOM because `markdown-render.ts`
 * binds a DOMPurify instance to the ambient `window` at import time. This file
 * creates nothing and closes nothing.
 */

let dom: ReturnType<typeof sharedDom>
let workspaceModule: typeof import('../src/web/features/settings/settings-workspace.js')

/** A stubbed read: either the value the real service would return, or a throw. */
type Stubbed<T> = { ok: true; value: T } | { ok: false; message: string }

const SERVER_OK: ServerPortSettings = {
  port: 4321,
  configuredPort: 5555,
  defaultPort: 4317,
  restartRequired: false
}

const DESKTOP_OK: DesktopSettings = { closeBehavior: 'minimize' }

let serverRead: Stubbed<ServerPortSettings>
let desktopRead: Stubbed<DesktopSettings>
let serverCalls = 0
let desktopCalls = 0

const realConsoleError = console.error
const realFetch = globalThis.fetch

beforeAll(async () => {
  dom = sharedDom()

  const globals = globalThis as unknown as Record<string, unknown>
  globals.Event = dom.window.Event
  globals.MouseEvent = dom.window.MouseEvent
  globals.KeyboardEvent = dom.window.KeyboardEvent
  globals.navigator = dom.window.navigator
  globals.IS_REACT_ACT_ENVIRONMENT = true
  // Mantine's transitions schedule through these.
  globals.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    dom.window.setTimeout(() => cb(Date.now()), 0) as unknown as number
  globals.cancelAnimationFrame = (id: number): void => dom.window.clearTimeout(id)
  // Mantine's ScrollArea measures its scrollbars with this on mount.
  globals.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  if (typeof globals.ResizeObserver === 'undefined') {
    // jsdom has no ResizeObserver; Mantine's ScrollArea observes its viewport.
    globals.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  }
  // React logs an act/environment warning per render; it is not a test signal.
  console.error = () => {}

  // The debug log persists its toggle through a store that may be bound to
  // jsdom's localStorage, which throws on this origin. Pin it to memory so
  // enabling Debug Mode for these tests cannot fail on the storage write.
  setDebugLogStorageForTests({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  })

  // Only the two reads are stubbed. `updateServerPort`, `restartServerOnPort`
  // and `serverBaseUrl` stay real — the save-failure test drives the real
  // service over a stubbed `fetch`, so the rejection is the one a user would
  // actually get.
  const actual = await import('../src/web/services/server-settings-api.js')
  mock.module('../src/web/services/server-settings-api.js', () => ({
    ...actual,
    getServerSettings: (): Promise<ServerPortSettings> => {
      serverCalls += 1
      return serverRead.ok
        ? Promise.resolve(serverRead.value)
        : Promise.reject(new Error(serverRead.message))
    },
    getDesktopSettings: (): Promise<DesktopSettings> => {
      desktopCalls += 1
      return desktopRead.ok
        ? Promise.resolve(desktopRead.value)
        : Promise.reject(new Error(desktopRead.message))
    }
  }))

  workspaceModule = await import('../src/web/features/settings/settings-workspace.js')
})

afterAll(() => {
  console.error = realConsoleError
  globalThis.fetch = realFetch
  // Releases the flush timer the display buffer would otherwise leave running
  // into the rest of the suite.
  setDebugLoggingEnabled(false)
  clearDebugLogView()

  const globals = globalThis as unknown as Record<string, unknown>
  delete globals.requestAnimationFrame
  delete globals.cancelAnimationFrame
  delete globals.getComputedStyle
})

beforeEach(() => {
  serverRead = { ok: true, value: SERVER_OK }
  desktopRead = { ok: true, value: DESKTOP_OK }
  serverCalls = 0
  desktopCalls = 0
  // A fresh debug session per test, so assertions cannot pass on another
  // test's events.
  setDebugLoggingEnabled(false)
  setDebugLoggingEnabled(true)
  clearDebugLogView()
})

interface Mounted {
  /** Lets the read promises settle and React commit their state updates. */
  settle: () => Promise<void>
  byTestId: (id: string) => Element | null
  click: (id: string) => Promise<void>
  /** Switches section, the way a user does: by clicking the nav row. */
  selectSection: (label: string) => Promise<void>
  portValue: () => string
  checkedCloseBehavior: () => string | null
  /** Debug events of the given name recorded since the last reset. */
  eventsNamed: (name: string) => { code?: string }[]
  cleanup: () => Promise<void>
}

async function mount(): Promise<Mounted> {
  const React = await import('react')
  const { act } = React as unknown as {
    act: (callback: () => Promise<void> | void) => Promise<void>
  }
  const { MantineProvider } = await import('@mantine/core')
  const { createRoot } = await import('react-dom/client')
  const { getDebugLogEntries } = await import('../src/web/diagnostics/debug-log.js')
  const { SettingsWorkspace } = workspaceModule

  const container = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(container)
  const root = createRoot(container)

  const settle = async (): Promise<void> => {
    await act(async () => {
      // A rejected read runs `.then` (skipped) then `.catch`, so more than one
      // microtask turn is needed. The extra turns cost nothing and keep the
      // helper independent of the current chain length.
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const byTestId = (id: string): Element | null => container.querySelector(`[data-testid="${id}"]`)

  const click = async (id: string): Promise<void> => {
    const element = byTestId(id)
    if (!element) throw new Error(`no element with data-testid="${id}"`)
    await act(async () => {
      element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await settle()
  }

  await act(async () => {
    root.render(
      React.createElement(
        MantineProvider,
        null,
        React.createElement(SettingsWorkspace, {
          // The real factory, not a hand-built literal: a partial object would
          // stop type-checking the moment a field is added, and these tests say
          // nothing about layout.
          layoutPrefs: defaultLayoutPreferences(),
          onLayoutReset: () => {},
          onClose: () => {}
        })
      )
    )
  })
  await settle()

  const harness: Mounted = {
    settle,
    byTestId,
    click,
    selectSection: async (label) => {
      const button = [...container.querySelectorAll('nav button')].find(
        (candidate) => candidate.textContent?.trim() === label
      )
      if (!button) throw new Error(`no settings section labelled "${label}"`)
      await act(async () => {
        button.dispatchEvent(
          new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
        )
      })
      await settle()
    },
    // Mantine spreads unknown props onto the `Input` itself, so `desktop-port`
    // IS the <input>. Resolving it by hand rather than assuming a wrapper: a
    // silent `''` from a failed lookup is indistinguishable from a real empty
    // port, which is the exact confusion this file exists to catch.
    portValue: () => {
      const host = byTestId('desktop-port')
      if (!host) throw new Error('the server-port field is not rendered')
      const input = host.matches('input')
        ? (host as HTMLInputElement)
        : host.querySelector<HTMLInputElement>('input')
      if (!input) throw new Error('the server-port field has no input element')
      return input.value
    },
    checkedCloseBehavior: () => {
      const group = byTestId('desktop-close-behavior')
      if (!group) throw new Error('the close-behavior group is not rendered')
      return group.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value ?? null
    },
    eventsNamed: (name) =>
      getDebugLogEntries()
        .filter((entry) => entry.evt === name)
        .map((entry) => ({ code: entry.fields.code })),
    cleanup: async () => {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  }
  return harness
}

describe('A failed settings read is visible in the panel, not swallowed', () => {
  it('says so when the server-port read fails, and does not show a fake port', async () => {
    serverRead = { ok: false, message: 'settings endpoint unreachable' }
    const ui = await mount()
    await ui.selectSection(UI_TEXT.settingsDesktop)

    const notice = ui.byTestId('settings-load-error')
    expect(notice).not.toBeNull()
    // The notice is outside the section list, so it is reachable from any
    // section and not hidden behind the Desktop tab.
    expect(notice?.textContent ?? '').toContain(UI_TEXT.settingsLoadFailedServer)
    // It must name the failure in terms the user can act on, not just a code.
    expect(UI_TEXT.settingsLoadFailedServer).toMatch(/port/i)
    expect(UI_TEXT.settingsLoadFailedServer).toMatch(/could not be loaded/i)
    // The read's own message rides along for diagnosis.
    expect(notice?.textContent ?? '').toContain('settings endpoint unreachable')
    // And the field is empty, not pre-filled with a plausible-looking port.
    expect(ui.portValue()).toBe('')

    await ui.cleanup()
  })

  it('reports the failure to the debug facility, with a code and no free text', async () => {
    serverRead = { ok: false, message: 'a private note title must never be logged' }
    const ui = await mount()

    const failures = ui.eventsNamed('error_api_failure')
    expect(failures).toHaveLength(1)
    expect(failures[0]?.code).toBe('get_server_settings')
    // The debug event allowlist carries no free text, so the read's own message
    // cannot ride along even by accident.
    expect(JSON.stringify(failures)).not.toContain('private note title')

    await ui.cleanup()
  })

  it('keeps the desktop values when only the server read fails', async () => {
    serverRead = { ok: false, message: 'server settings unavailable' }
    const ui = await mount()
    await ui.selectSection(UI_TEXT.settingsDesktop)

    // The desktop read is a different endpoint over a different file, so it
    // still renders. A single shared error flag would have blanked this.
    expect(ui.checkedCloseBehavior()).toBe(DESKTOP_OK.closeBehavior)
    // ...and the notice blames the server read alone.
    const notice = ui.byTestId('settings-load-error')?.textContent ?? ''
    expect(notice).toContain(UI_TEXT.settingsLoadFailedServer)
    expect(notice).not.toContain(UI_TEXT.settingsLoadFailedDesktop)
    expect(ui.byTestId('settings-load-error-desktop')).toBeNull()

    await ui.cleanup()
  })

  it('keeps the port when only the desktop read fails', async () => {
    desktopRead = { ok: false, message: 'desktop settings unavailable' }
    const ui = await mount()
    await ui.selectSection(UI_TEXT.settingsDesktop)

    // The surviving read is the other half of the original defect: the port
    // was the field that looked editable while showing a placeholder.
    expect(ui.portValue()).toBe(String(SERVER_OK.configuredPort))

    const notice = ui.byTestId('settings-load-error')?.textContent ?? ''
    expect(notice).toContain(UI_TEXT.settingsLoadFailedDesktop)
    expect(notice).not.toContain(UI_TEXT.settingsLoadFailedServer)
    expect(ui.byTestId('settings-load-error-server')).toBeNull()
    // The close options fall back to a default, which the copy admits to.
    expect(UI_TEXT.settingsLoadFailedDesktop).toMatch(/default/i)

    const failures = ui.eventsNamed('error_api_failure')
    expect(failures).toHaveLength(1)
    expect(failures[0]?.code).toBe('get_desktop_settings')

    await ui.cleanup()
  })

  it('reports both reads separately when both fail', async () => {
    serverRead = { ok: false, message: 'server down' }
    desktopRead = { ok: false, message: 'desktop down' }
    const ui = await mount()

    expect(ui.byTestId('settings-load-error-server')).not.toBeNull()
    expect(ui.byTestId('settings-load-error-desktop')).not.toBeNull()
    const notice = ui.byTestId('settings-load-error')?.textContent ?? ''
    expect(notice).toContain(UI_TEXT.settingsLoadFailedServer)
    expect(notice).toContain(UI_TEXT.settingsLoadFailedDesktop)

    // Both are diagnosable, and each is distinguishable from the other.
    const codes = ui.eventsNamed('error_api_failure').map((event) => event.code)
    expect(codes).toContain('get_server_settings')
    expect(codes).toContain('get_desktop_settings')

    await ui.cleanup()
  })

  it('clears the notice only when a retry actually succeeds', async () => {
    serverRead = { ok: false, message: 'server down' }
    const ui = await mount()
    expect(ui.byTestId('settings-load-error')).not.toBeNull()

    // A retry that fails again must not make the notice blink out and leave the
    // wrong values on screen looking settled.
    await ui.click('settings-load-retry')
    expect(serverCalls).toBe(2)
    expect(ui.byTestId('settings-load-error')).not.toBeNull()

    serverRead = { ok: true, value: SERVER_OK }
    await ui.click('settings-load-retry')
    expect(serverCalls).toBe(3)
    expect(ui.byTestId('settings-load-error')).toBeNull()
    await ui.selectSection(UI_TEXT.settingsDesktop)
    expect(ui.portValue()).toBe(String(SERVER_OK.configuredPort))

    await ui.cleanup()
  })

  it('offers a retry labelled from the dictionary', async () => {
    serverRead = { ok: false, message: 'server down' }
    const ui = await mount()

    const retry = ui.byTestId('settings-load-retry')
    expect(retry).not.toBeNull()
    expect(retry?.textContent?.trim()).toBe(UI_TEXT.retry)

    await ui.cleanup()
  })
})

describe('The success path is unchanged', () => {
  it('renders both reads, shows no notice, and logs no failure', async () => {
    const ui = await mount()
    await ui.selectSection(UI_TEXT.settingsDesktop)

    expect(ui.byTestId('settings-load-error')).toBeNull()
    expect(ui.portValue()).toBe(String(SERVER_OK.configuredPort))
    expect(ui.checkedCloseBehavior()).toBe(DESKTOP_OK.closeBehavior)
    expect(ui.eventsNamed('error_api_failure')).toHaveLength(0)
    // Both reads still happen, once each, on mount.
    expect(serverCalls).toBe(1)
    expect(desktopCalls).toBe(1)

    await ui.cleanup()
  })
})

describe('A failed close-behavior save is reported too', () => {
  it('tells the user the choice did not stick, and puts the stored one back', async () => {
    const ui = await mount()
    await ui.selectSection(UI_TEXT.settingsDesktop)
    expect(ui.checkedCloseBehavior()).toBe(DESKTOP_OK.closeBehavior)

    // The real service over a failing transport, so this is the rejection a
    // user would get rather than a synthesised one.
    globalThis.fetch = (() => Promise.reject(new Error('network down'))) as unknown as typeof fetch
    const quit = ui
      .byTestId('desktop-close-behavior')
      ?.querySelector<HTMLInputElement>('input[type="radio"][value="quit"]')
    expect(quit).not.toBeNull()
    await ui.settle()
    await (async () => {
      quit?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
    })()
    await ui.settle()

    // Kept as a property assertion, but note what it does NOT prove: this also
    // passes with the catch swallowed, because `Radio.Group` is controlled and
    // reconciles back to the stored value on the next render. The assertions
    // that actually catch the swallowed catch are the message and the event
    // below — they are what the defect removed.
    expect(ui.checkedCloseBehavior()).toBe(DESKTOP_OK.closeBehavior)

    const message = ui.byTestId('desktop-close-message')
    expect(message).not.toBeNull()
    expect(message?.textContent ?? '').toContain('network down')
    expect(ui.eventsNamed('error_api_failure').map((event) => event.code)).toContain(
      'update_close_behavior'
    )

    globalThis.fetch = realFetch
    await ui.cleanup()
  })
})
