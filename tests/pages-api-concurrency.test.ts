import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { Page } from '../src/shared/contracts/pages.js'
import type { Scheduler } from '../src/web/features/rich-editor/autosave-controller.js'
import { createAutosaveController } from '../src/web/features/rich-editor/autosave-controller.js'
import * as api from '../src/web/services/pages-api.js'

// Namespace import (never a named one) so a missing export is a failing
// assertion rather than a module-link error.
//
// Every test uses its own page id: the client keeps per-page state (the observed
// version, and the latch set by a conflict) for the life of the module, so a
// shared id would leak one test's conflict into the next.

interface FetchCall {
  url: string
  method: string
  body: unknown
}

let calls: FetchCall[] = []
let responder: (call: FetchCall) => Response
const realFetch = globalThis.fetch

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function makePage(id: string, overrides: Partial<Page> = {}): Page {
  const now = new Date().toISOString()
  return {
    id,
    title: 'Concurrency page',
    content: 'stored',
    pageType: 'rich',
    parentId: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    ...overrides
  }
}

/** The list endpoint the client must call to learn a page's version. */
function listResponder(page: Page) {
  return (call: FetchCall): Response => {
    if (call.method === 'GET') return jsonResponse(200, { pages: [page], total: 1 })
    throw new Error(`unexpected ${call.method} ${call.url}`)
  }
}

beforeEach(() => {
  calls = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call: FetchCall = {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    }
    calls.push(call)
    return responder(call)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('pages-api write concurrency', () => {
  it('sends the version the client last observed for the page', async () => {
    const id = '10000000-0000-0000-0000-000000000001'
    responder = listResponder(makePage(id, { version: 3 }))
    await api.listPages(undefined)

    responder = (call) => {
      if (call.method !== 'PATCH') throw new Error(`unexpected ${call.method}`)
      return jsonResponse(200, { page: makePage(id, { version: 4, content: 'next' }) })
    }

    const saved = await api.updatePage(id, { content: 'next' })
    expect(saved.version).toBe(4)

    const patch = calls.at(-1)
    expect(patch?.method).toBe('PATCH')
    const sent = patch?.body as { version: number } | undefined
    expect(sent?.version).toBe(3)
  })

  it('advances its baseline after a successful write so sequential saves keep working', async () => {
    const id = '10000000-0000-0000-0000-000000000002'
    responder = listResponder(makePage(id, { version: 1 }))
    await api.listPages(undefined)

    let serverVersion = 1
    responder = (call) => {
      const body = call.body as { version: number }
      expect(body.version).toBe(serverVersion)
      serverVersion += 1
      return jsonResponse(200, { page: makePage(id, { version: serverVersion }) })
    }

    await api.updatePage(id, { content: 'first' })
    await api.updatePage(id, { content: 'second' })
    expect(serverVersion).toBe(3)
  })

  it('an explicit version in the request wins over the cached baseline', async () => {
    const id = '10000000-0000-0000-0000-000000000003'
    responder = listResponder(makePage(id, { version: 1 }))
    await api.listPages(undefined)

    responder = () => jsonResponse(200, { page: makePage(id, { version: 8 }) })
    await api.updatePage(id, { content: 'x', version: 7 })
    const patch = calls.at(-1)
    const sent = patch?.body as { version: number } | undefined
    expect(sent?.version).toBe(7)
  })

  it('throws a distinguishable conflict error and never silently overwrites', async () => {
    const id = '10000000-0000-0000-0000-000000000004'
    responder = listResponder(makePage(id, { version: 2 }))
    await api.listPages(undefined)

    responder = () =>
      jsonResponse(409, {
        error: 'This page changed since you opened it. Your changes were not saved.'
      })

    let thrown: unknown
    try {
      await api.updatePage(id, { content: 'the other tab wins' })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(api.PageVersionConflictError)
    const conflict = thrown as InstanceType<(typeof api)['PageVersionConflictError']>
    expect(conflict.status).toBe(409)
    expect(conflict.pageId).toBe(id)
    expect(conflict.offeredVersion).toBe(2)
    expect(conflict.message).toContain('not saved')
  })

  it('does not retry a conflicted page, even after a background list refresh', async () => {
    const id = '10000000-0000-0000-0000-000000000005'
    responder = listResponder(makePage(id, { version: 2 }))
    await api.listPages(undefined)

    responder = () => jsonResponse(409, { error: 'changed elsewhere' })
    await expect(api.updatePage(id, { content: 'mine' })).rejects.toThrow()

    // A later refresh reports the newer version (as a second tab's write would).
    const callsAfterConflict = calls.length
    responder = listResponder(makePage(id, { version: 3, content: 'the other tab wins' }))
    await api.listPages(undefined)
    expect(calls.length).toBe(callsAfterConflict + 1)

    responder = () => jsonResponse(409, { error: 'changed elsewhere' })
    await expect(api.updatePage(id, { content: 'mine again' })).rejects.toThrow()
    // The retry never reached the network: only the list call above did.
    expect(calls.length).toBe(callsAfterConflict + 1)
  })

  it('keeps the autosave pending content and does not loop on a conflict', async () => {
    const id = '10000000-0000-0000-0000-000000000006'
    responder = listResponder(makePage(id, { version: 2 }))
    await api.listPages(undefined)

    let patched = 0
    responder = (call) => {
      if (call.method === 'PATCH') patched += 1
      return jsonResponse(409, { error: 'This page changed since you opened it.' })
    }

    const pendingTimers = new Map<number, () => void>()
    let nextTimerId = 0
    const scheduler: Scheduler = {
      setTimeout(fn: () => void): number {
        const timerId = nextTimerId++
        pendingTimers.set(timerId, fn)
        return timerId
      },
      clearTimeout(timerId: number): void {
        pendingTimers.delete(timerId)
      }
    }

    const controller = createAutosaveController({
      debounceMs: 2000,
      scheduler,
      onSave: async (pageId, content) => {
        await api.updatePage(pageId, { content })
      }
    })

    const localText = 'text the user typed in this tab'
    controller.notifyEdit(id, localText)

    // Fire the debounce timer: one attempt, which the server rejects. The fake
    // scheduler drops a fired entry the way a real timer is gone afterwards, so
    // anything left behind was re-armed by the failed save.
    const armed = Array.from(pendingTimers.keys())
    const fired = armed.map((timerId) => {
      const fn = pendingTimers.get(timerId) as () => Promise<void>
      pendingTimers.delete(timerId)
      return fn
    })
    await Promise.all(fired.map((fn) => fn()))

    const state = controller.getState()
    expect(state.status).toBe('error')
    expect(state.error).toContain('changed')
    // The user's text is still there, byte for byte, and still pending.
    expect(state.pendingContent).toBe(localText)
    expect(state.pendingPageId).toBe(id)
    expect(patched).toBe(1)

    // No timer was re-armed by the failure: nothing can loop on its own.
    expect(pendingTimers.size).toBe(0)

    // The explicit retry/flush paths cannot loop either: the conflict is
    // remembered, so no further write is even attempted.
    await controller.retry()
    await controller.flush()
    expect(patched).toBe(1)
    expect(controller.getState().pendingContent).toBe(localText)
  })

  it('keeps the conflict scoped to the page that conflicted', async () => {
    const first = makePage('10000000-0000-0000-0000-000000000007', { version: 1 })
    const second = makePage('10000000-0000-0000-0000-000000000008', { version: 5 })
    responder = (call) =>
      call.method === 'GET'
        ? jsonResponse(200, { pages: [first, second], total: 2 })
        : jsonResponse(200, { page: first })
    await api.listPages(undefined)

    responder = (call) =>
      call.url.includes(first.id)
        ? jsonResponse(409, { error: 'changed elsewhere' })
        : jsonResponse(200, { page: makePage(second.id, { version: 6 }) })
    await expect(api.updatePage(first.id, { content: 'mine' })).rejects.toThrow()

    const saved = await api.updatePage(second.id, { content: 'unrelated edit' })
    expect(saved.version).toBe(6)
  })

  it('performs no write at all when the page version is unknown', async () => {
    responder = () => jsonResponse(200, { page: makePage('unused') })
    const before = calls.length
    let thrown: unknown
    try {
      await api.updatePage('10000000-0000-0000-0000-000000000009', { content: 'blind write' })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message.length).toBeGreaterThan(0)
    // No blind write: the failure happened before any request.
    expect(calls.length).toBe(before)
  })

  it('registers the version of a created page so its first save is guarded', async () => {
    const id = '10000000-0000-0000-0000-00000000000a'
    const page = makePage(id, { version: 1, title: 'Fresh' })
    responder = (call) =>
      call.method === 'POST' ? jsonResponse(201, { page }) : jsonResponse(200, { page })
    const created = await api.createPage({ title: 'Fresh', pageType: 'rich', content: '' })
    expect(created.version).toBe(1)

    let sent: number | undefined
    responder = (call) => {
      sent = (call.body as { version: number }).version
      return jsonResponse(200, { page: makePage(id, { version: 2 }) })
    }
    await api.updatePage(id, { content: 'first edit' })
    expect(sent).toBe(1)
  })

  it('passes the search query through unchanged', async () => {
    responder = () => jsonResponse(200, { pages: [], total: 0 })
    const result = await api.listPages(undefined, { q: 'quantum' })
    expect(result.total).toBe(0)
    expect(calls[0]?.url).toContain('q=quantum')
  })
})
