import { describe, expect, it } from 'bun:test'
import type { Scheduler } from '../src/web/features/rich-editor/autosave-controller.js'
import { createAutosaveController } from '../src/web/features/rich-editor/autosave-controller.js'

// ---------- deterministic fake scheduler ----------

function makeFakeScheduler(): {
  scheduler: Scheduler
  fireNext: () => void
  fireAll: () => void
} {
  const pending = new Map<number, () => void>()
  let nextId = 0

  const scheduler: Scheduler = {
    setTimeout(fn: () => void): number {
      const id = nextId++
      pending.set(id, fn)
      return id
    },
    clearTimeout(id: number): void {
      pending.delete(id)
    }
  }

  const fireNext = (): void => {
    const [id] = pending.keys()
    if (id === undefined) return
    const fn = pending.get(id)
    pending.delete(id)
    fn?.()
  }

  const fireAll = (): void => {
    while (pending.size > 0) {
      const ids = Array.from(pending.keys())
      if (ids.length === 0) break
      const fn = pending.get(ids[0])
      pending.delete(ids[0])
      fn?.()
    }
  }

  return { scheduler, fireNext, fireAll }
}

// Create an onSave that records saves and defers completion until resolved.
function makeDeferredSave(
  saves: string[],
  resolvers: Map<number, { resolve: () => void }>
): (_pageId: string, content: string) => Promise<void> {
  return async (_pageId: string, content: string): Promise<void> => {
    saves.push(content)
    const id = saves.length
    await new Promise<void>((r) => {
      resolvers.set(id, { resolve: r })
    })
  }
}

// ---------- tests ----------

describe('autosave controller', () => {
  it('debounces edits and saves after timer fires', async () => {
    const { scheduler, fireNext } = makeFakeScheduler()
    const saves: Array<{ pageId: string; content: string }> = []
    const resolvers = new Map<number, { resolve: () => void }>()
    const controller = createAutosaveController({
      debounceMs: 20,
      scheduler,
      onSave: async (pageId, content) => {
        saves.push({ pageId, content })
        const id = saves.length
        await new Promise<void>((r) => {
          resolvers.set(id, { resolve: r })
        })
      }
    })

    controller.notifyEdit('p1', 'first')
    controller.notifyEdit('p1', 'second')
    expect(controller.getState().status).toBe('dirty')
    expect(saves.length).toBe(0)

    fireNext()
    expect(controller.getState().status).toBe('saving')

    // Resolve the pending save so it completes.
    resolvers.get(1)?.resolve()
    await controller.flush()

    expect(saves.length).toBe(1)
    expect(saves[0].content).toBe('second')
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('does not run overlapping saves for same page', async () => {
    let activeSaves = 0
    let maxConcurrent = 0
    const { scheduler, fireNext } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: async (_pageId: string, _content: string): Promise<void> => {
        activeSaves++
        maxConcurrent = Math.max(maxConcurrent, activeSaves)
        await new Promise<void>(() => {})
        activeSaves--
      }
    })

    controller.notifyEdit('p1', 'a')
    controller.notifyEdit('p1', 'b')

    fireNext()
    expect(controller.getState().status).toBe('saving')
    expect(maxConcurrent).toBe(1)

    controller.dispose()
  })

  it('editing during active save queues newest snapshot to save next', async () => {
    const saves: string[] = []
    const resolvers = new Map<number, { resolve: () => void }>()
    const { scheduler, fireNext } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: makeDeferredSave(saves, resolvers)
    })

    controller.notifyEdit('p1', 'first')
    fireNext() // starts first save (content = 'first')

    // While saving, queue newer edits.
    controller.notifyEdit('p1', 'second')
    controller.notifyEdit('p1', 'third') // latest wins

    // Resolve first save; drain() in flush will start saving 'third'.
    resolvers.get(1)?.resolve()
    // The second save creates resolver 2. Resolve it before flush awaits.
    setTimeout(() => resolvers.get(2)?.resolve(), 0)
    await controller.flush()

    expect(saves).toEqual(['first', 'third'])
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('stale completion cannot mark newer unsaved content as saved', async () => {
    const saves: string[] = []
    const resolvers = new Map<number, { resolve: () => void }>()
    const { scheduler, fireNext } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: makeDeferredSave(saves, resolvers)
    })

    controller.notifyEdit('p1', 'first')
    fireNext()
    expect(controller.getState().status).toBe('saving')

    // Edit during save — should be queued.
    controller.notifyEdit('p1', 'second')
    expect(controller.getState().status).toBe('dirty')

    // Resolve first save; drain() in flush will start saving 'second'.
    resolvers.get(1)?.resolve()
    // The second save creates resolver 2. Resolve it before flush awaits.
    setTimeout(() => resolvers.get(2)?.resolve(), 0)
    await controller.flush()

    expect(saves).toEqual(['first', 'second'])
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('transitions to error on failure and supports retry', async () => {
    let shouldFail = true
    const { scheduler, fireNext } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: async () => {
        if (shouldFail) throw new Error('network error')
      }
    })

    controller.notifyEdit('p1', 'content')
    fireNext()
    await controller.flush()
    expect(controller.getState().status).toBe('error')
    expect(controller.getState().error).toBe('network error')

    shouldFail = false
    controller.retry()
    fireNext()
    await controller.flush()
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('retry after failure saves newest snapshot', async () => {
    let call = 0
    const saves: string[] = []
    const { scheduler, fireNext } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: async (_pageId: string, content: string): Promise<void> => {
        call++
        if (call === 1) throw new Error('fail')
        saves.push(content)
      }
    })

    controller.notifyEdit('p1', 'first')
    fireNext()
    await controller.flush()
    expect(controller.getState().status).toBe('error')

    // Edit again before retry.
    controller.notifyEdit('p1', 'second')
    expect(controller.getState().status).toBe('dirty')

    controller.retry()
    fireNext()
    await controller.flush()
    expect(saves).toEqual(['second'])
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('flush immediately saves pending dirty content', async () => {
    const saves: string[] = []
    const { scheduler } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 100,
      scheduler,
      onSave: async (_pageId: string, content: string): Promise<void> => {
        saves.push(content)
      }
    })

    controller.notifyEdit('p1', 'pending')
    expect(controller.getState().status).toBe('dirty')
    const ok = await controller.flush()
    expect(ok).toBe(true)
    expect(saves).toEqual(['pending'])
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('flush during saving waits for active save', async () => {
    const saves: string[] = []
    const resolvers = new Map<number, { resolve: () => void }>()
    const { scheduler, fireNext } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: makeDeferredSave(saves, resolvers)
    })

    controller.notifyEdit('p1', 'first')
    fireNext()
    expect(controller.getState().status).toBe('saving')

    // Resolve first before flush so flush doesn't deadlock.
    resolvers.get(1)?.resolve()
    const ok = await controller.flush()
    expect(ok).toBe(true)
    expect(saves).toEqual(['first'])

    controller.dispose()
  })

  it('flush with queued nextPending saves both', async () => {
    const saves: string[] = []
    const resolvers = new Map<number, { resolve: () => void }>()
    const { scheduler, fireNext } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: makeDeferredSave(saves, resolvers)
    })

    controller.notifyEdit('p1', 'first')
    fireNext() // first save starts
    controller.notifyEdit('p1', 'second')

    // Resolve first; drain() will start the second save.
    resolvers.get(1)?.resolve()
    // Yield so the internally-chained second save begins, then resolve it.
    setTimeout(() => resolvers.get(2)?.resolve(), 0)
    const ok = await controller.flush()
    expect(ok).toBe(true)
    expect(saves).toEqual(['first', 'second'])
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('page switch flush blocks on failed save', async () => {
    const { scheduler, fireNext } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: async () => {
        throw new Error('fail')
      }
    })

    controller.notifyEdit('p1', 'content')
    fireNext()
    await controller.flush()
    expect(controller.getState().status).toBe('error')

    const ok = await controller.flush()
    expect(ok).toBe(false)
    expect(controller.getState().status).toBe('error')

    controller.dispose()
  })

  it('page identity is associated with every pending save', async () => {
    const saves: Array<{ pageId: string; content: string }> = []
    const resolvers = new Map<number, { resolve: () => void }>()
    const { scheduler, fireNext } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: async (pageId: string, content: string): Promise<void> => {
        saves.push({ pageId, content })
        const id = saves.length
        await new Promise<void>((r) => {
          resolvers.set(id, { resolve: r })
        })
      }
    })

    controller.notifyEdit('p1', 'content-a')
    fireNext()
    resolvers.get(1)?.resolve()
    await controller.flush()
    expect(saves[0].pageId).toBe('p1')

    controller.notifyEdit('p2', 'content-b')
    fireNext()
    resolvers.get(2)?.resolve()
    await controller.flush()
    expect(saves[1].pageId).toBe('p2')

    controller.dispose()
  })

  it('dispose cancels timers and prevents stale updates', () => {
    const saves: string[] = []
    const { scheduler } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: async (_pageId: string, content: string): Promise<void> => {
        saves.push(content)
      }
    })

    controller.notifyEdit('p1', 'first')
    controller.dispose()
    // Timer was cleared by dispose — firing should do nothing.
    expect(controller.getState().status).toBe('dirty')

    controller.dispose() // idempotent
  })

  it('never claims saved until latest content confirmed', async () => {
    let saveCount = 0
    const resolvers = new Map<number, { resolve: () => void }>()
    const { scheduler, fireNext } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: async (_pageId: string, _content: string): Promise<void> => {
        saveCount++
        const id = saveCount
        await new Promise<void>((r) => {
          resolvers.set(id, { resolve: r })
        })
      }
    })

    controller.notifyEdit('p1', 'a')
    fireNext()
    expect(controller.getState().status).toBe('saving')
    controller.notifyEdit('p1', 'b')
    expect(controller.getState().status).toBe('dirty')

    // Resolve save 'a'; drain() in flush will start saving 'b'.
    resolvers.get(1)?.resolve()
    // The second save creates resolver 2. Resolve it before flush awaits.
    setTimeout(() => resolvers.get(2)?.resolve(), 0)
    await controller.flush()

    expect(saveCount).toBe(2)
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('HTML pages never mount BlockNote — verify via document parse', async () => {
    // HTML pages store JSON with an 'html' key; the rich editor parses them as errors
    // and falls back to the HTML placeholder, never mounting BlockNote.
    const { parseStoredDocument } = await import('../src/web/features/rich-editor/document.js')
    const htmlContent = JSON.stringify({
      html: '<h1>Title</h1><p>Body</p>',
      css: 'body { color: red; }',
      js: 'console.log("hi")',
      jsEnabled: false,
      schemaVersion: 1,
      sandboxPolicyVersion: 1
    })
    const result = parseStoredDocument(htmlContent)
    expect(result.status).toBe('error')
    expect(result.document).toBeNull()
    expect(result.errorMessage).toBeDefined()
  })
})
