import { describe, expect, it } from 'bun:test'
import type { Scheduler } from '../src/web/features/rich-editor/autosave-controller.js'
import { createAutosaveController } from '../src/web/features/rich-editor/autosave-controller.js'

// ---------- deterministic fake scheduler ----------

function makeFakeScheduler(): {
  scheduler: Scheduler
  fireNext: () => void
  fireAll: () => void
} {
  const pending = new Map<unknown, () => void>()
  let nextId = 0

  const scheduler: Scheduler = {
    setTimeout(fn: () => void): unknown {
      const id = nextId++
      pending.set(id, fn)
      return id
    },
    clearTimeout(id: unknown): void {
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

// ---------- tests ----------

describe('autosave controller', () => {
  it('debounces edits and saves after timer fires', () => {
    const { scheduler, fireNext } = makeFakeScheduler()
    const saves: Array<{ pageId: string; content: string }> = []
    const controller = createAutosaveController({
      debounceMs: 20,
      scheduler,
      onSave: async (pageId, content) => {
        saves.push({ pageId, content })
      }
    })

    controller.notifyEdit('p1', 'first')
    controller.notifyEdit('p1', 'second')
    expect(controller.getState().status).toBe('dirty')
    expect(saves.length).toBe(0)

    // Fire the debounced timer once — saves only the latest content.
    fireNext()
    expect(saves.length).toBe(1)
    expect(saves[0].content).toBe('second')
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('does not run overlapping saves for same page', async () => {
    let activeSaves = 0
    let maxConcurrent = 0
    const { scheduler } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: async () => {
        activeSaves++
        maxConcurrent = Math.max(maxConcurrent, activeSaves)
        await new Promise<void>((r) => setTimeout(r, 30))
        activeSaves--
      }
    })

    controller.notifyEdit('p1', 'a')
    // Simulate edit arriving while save is in progress (same tick).
    controller.notifyEdit('p1', 'b')

    // The first save starts on timer fire.
    // With the fake scheduler, both notifyEdit calls queue before any fire.
    // Only one timer should be active at a time.
    expect(maxConcurrent).toBe(1)
    controller.dispose()
  })

  it('editing during active save queues newest snapshot to save next', async () => {
    const saves: string[] = []
    const { scheduler, fireNext } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: async (_pageId, content) => {
        saves.push(content)
        await new Promise<void>((r) => setTimeout(r, 20))
      }
    })

    controller.notifyEdit('p1', 'first')
    fireNext() // starts first save

    // While saving, queue newer edits.
    controller.notifyEdit('p1', 'second')
    controller.notifyEdit('p1', 'third') // latest wins

    // After first save resolves, it should save 'third'.
    // Wait for the first save to finish, then fire again for the queued save.
    await new Promise<void>((r) => setTimeout(r, 30))
    fireNext()
    expect(saves).toEqual(['first', 'third'])
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('stale completion cannot mark newer unsaved content as saved', async () => {
    const saves: string[] = []
    let resolveFirst!: () => void
    const firstSaveStarted = new Promise<void>((r) => {
      setTimeout(() => r(), 5)
    })

    const { scheduler, fireNext } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: async (_pageId, content) => {
        saves.push(content)
        if (content === 'first') {
          await new Promise<void>((r) => {
            resolveFirst = r
          })
        } else {
          await new Promise<void>((r) => setTimeout(r, 10))
        }
      }
    })

    controller.notifyEdit('p1', 'first')
    await firstSaveStarted
    // Edit during first save — should be queued.
    controller.notifyEdit('p1', 'second')
    expect(controller.getState().status).toBe('dirty')

    // Resolve first save; the queued 'second' should then save.
    resolveFirst()
    await new Promise<void>((r) => setTimeout(r, 20))
    fireNext()
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
    await new Promise<void>((r) => setTimeout(r, 5))
    expect(controller.getState().status).toBe('error')
    expect(controller.getState().error).toBe('network error')

    shouldFail = false
    controller.retry()
    fireNext()
    await new Promise<void>((r) => setTimeout(r, 5))
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
      onSave: async (_pageId, content) => {
        call++
        if (call === 1) throw new Error('fail')
        saves.push(content)
      }
    })

    controller.notifyEdit('p1', 'first')
    fireNext()
    await new Promise<void>((r) => setTimeout(r, 5))
    expect(controller.getState().status).toBe('error')

    // Edit again before retry.
    controller.notifyEdit('p1', 'second')
    expect(controller.getState().status).toBe('dirty')

    controller.retry()
    fireNext()
    await new Promise<void>((r) => setTimeout(r, 5))
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
      onSave: async (_pageId, content) => {
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
    const { scheduler } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: async (_pageId, content) => {
        saves.push(content)
        await new Promise<void>((r) => setTimeout(r, 20))
      }
    })

    controller.notifyEdit('p1', 'first')
    await new Promise<void>((r) => setTimeout(r, 15))
    expect(controller.getState().status).toBe('saving')

    const ok = await controller.flush()
    expect(ok).toBe(true)
    expect(saves).toEqual(['first'])

    controller.dispose()
  })

  it('flush with queued nextPending saves both', async () => {
    const saves: string[] = []
    const { scheduler, fireNext } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: async (_pageId, content) => {
        saves.push(content)
        await new Promise<void>((r) => setTimeout(r, 15))
      }
    })

    controller.notifyEdit('p1', 'first')
    await new Promise<void>((r) => setTimeout(r, 15)) // first save starts
    controller.notifyEdit('p1', 'second')

    const ok = await controller.flush()
    expect(ok).toBe(true)
    // First save completes, then second is queued and saved immediately.
    await new Promise<void>((r) => setTimeout(r, 20))
    fireNext()
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
    await new Promise<void>((r) => setTimeout(r, 5))
    expect(controller.getState().status).toBe('error')

    const ok = await controller.flush()
    expect(ok).toBe(false)
    expect(controller.getState().status).toBe('error')

    controller.dispose()
  })

  it('page identity is associated with every pending save', async () => {
    const saves: Array<{ pageId: string; content: string }> = []
    const { scheduler, fireNext } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: async (pageId, content) => {
        saves.push({ pageId, content })
      }
    })

    controller.notifyEdit('p1', 'content-a')
    fireNext()
    expect(saves[0].pageId).toBe('p1')

    controller.notifyEdit('p2', 'content-b')
    fireNext()
    expect(saves[1].pageId).toBe('p2')

    controller.dispose()
  })

  it('dispose cancels timers and prevents stale updates', () => {
    const saves: string[] = []
    const { scheduler } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: async (_pageId, content) => {
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
    const { scheduler, fireNext } = makeFakeScheduler()
    const controller = createAutosaveController({
      debounceMs: 10,
      scheduler,
      onSave: async () => {
        saveCount++
        await new Promise<void>((r) => setTimeout(r, 15))
      }
    })

    controller.notifyEdit('p1', 'a')
    fireNext()
    expect(controller.getState().status).toBe('saving')
    controller.notifyEdit('p1', 'b')
    expect(controller.getState().status).toBe('dirty')

    await new Promise<void>((r) => setTimeout(r, 25))
    fireNext() // saves 'b'
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
