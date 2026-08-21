import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createAutosaveController } from '../src/web/features/rich-editor/autosave-controller.js'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('autosave controller', () => {
  it('debounces edits and saves after delay', async () => {
    const saves: Array<{ pageId: string; content: string }> = []
    const controller = createAutosaveController({
      debounceMs: 20,
      onSave: async (pageId, content) => {
        saves.push({ pageId, content })
      }
    })

    controller.notifyEdit('p1', 'first')
    controller.notifyEdit('p1', 'second')
    // Should be dirty, not yet saved
    expect(controller.getState().status).toBe('dirty')
    expect(saves.length).toBe(0)

    await sleep(40)
    expect(saves.length).toBe(1)
    expect(saves[0].content).toBe('second')
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('does not run overlapping saves for same page', async () => {
    let activeSaves = 0
    let maxConcurrent = 0
    const controller = createAutosaveController({
      debounceMs: 10,
      onSave: async () => {
        activeSaves++
        maxConcurrent = Math.max(maxConcurrent, activeSaves)
        await sleep(30)
        activeSaves--
      }
    })

    controller.notifyEdit('p1', 'a')
    await sleep(20) // triggers first save
    controller.notifyEdit('p1', 'b') // edit during save

    await sleep(80)
    expect(maxConcurrent).toBe(1)
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('editing during active save queues newest snapshot to save next', async () => {
    const saves: string[] = []
    const controller = createAutosaveController({
      debounceMs: 10,
      onSave: async (_pageId, content) => {
        saves.push(content)
        await sleep(20)
      }
    })

    controller.notifyEdit('p1', 'first')
    await sleep(15) // first save starts
    expect(controller.getState().status).toBe('saving')

    controller.notifyEdit('p1', 'second')
    controller.notifyEdit('p1', 'third') // latest should win

    await sleep(60)
    expect(saves).toEqual(['first', 'third'])
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('stale completion cannot mark newer unsaved content as saved', async () => {
    const saves: string[] = []
    let resolveFirst!: () => void
    const firstSaveStarted = new Promise<void>((r) => {
      // Will be resolved when first save starts
      setTimeout(() => r(), 15)
    })

    const controller = createAutosaveController({
      debounceMs: 10,
      onSave: async (_pageId, content) => {
        saves.push(content)
        if (content === 'first') {
          await new Promise<void>((r) => {
            resolveFirst = r
          })
        } else {
          await sleep(10)
        }
      }
    })

    controller.notifyEdit('p1', 'first')
    await firstSaveStarted
    await sleep(5)
    // Edit during first save - should be queued
    controller.notifyEdit('p1', 'second')
    expect(controller.getState().status).toBe('dirty')

    // Resolve first save
    resolveFirst()
    await sleep(30)

    expect(saves).toEqual(['first', 'second'])
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('transitions to error on failure and supports retry', async () => {
    let shouldFail = true
    const controller = createAutosaveController({
      debounceMs: 10,
      onSave: async () => {
        if (shouldFail) throw new Error('network error')
      }
    })

    controller.notifyEdit('p1', 'content')
    await sleep(30)
    expect(controller.getState().status).toBe('error')
    expect(controller.getState().error).toBe('network error')

    shouldFail = false
    controller.retry()
    await sleep(20)
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('retry after failure saves newest snapshot', async () => {
    let call = 0
    const saves: string[] = []
    const controller = createAutosaveController({
      debounceMs: 10,
      onSave: async (_pageId, content) => {
        call++
        if (call === 1) throw new Error('fail')
        saves.push(content)
      }
    })

    controller.notifyEdit('p1', 'first')
    await sleep(30)
    expect(controller.getState().status).toBe('error')

    // Edit again before retry
    controller.notifyEdit('p1', 'second')
    expect(controller.getState().status).toBe('dirty')

    controller.retry()
    await sleep(20)
    expect(saves).toEqual(['second'])
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('flush immediately saves pending dirty content', async () => {
    const saves: string[] = []
    const controller = createAutosaveController({
      debounceMs: 100,
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
    const controller = createAutosaveController({
      debounceMs: 10,
      onSave: async (_pageId, content) => {
        saves.push(content)
        await sleep(20)
      }
    })

    controller.notifyEdit('p1', 'first')
    await sleep(15)
    expect(controller.getState().status).toBe('saving')

    const flushPromise = controller.flush()
    const ok = await flushPromise
    expect(ok).toBe(true)
    expect(saves).toEqual(['first'])

    controller.dispose()
  })

  it('flush with queued nextPending saves both', async () => {
    const saves: string[] = []
    const controller = createAutosaveController({
      debounceMs: 10,
      onSave: async (_pageId, content) => {
        saves.push(content)
        await sleep(15)
      }
    })

    controller.notifyEdit('p1', 'first')
    await sleep(15) // first save starts
    controller.notifyEdit('p1', 'second')

    const ok = await controller.flush()
    expect(ok).toBe(true)
    // Should have saved both first and second
    await sleep(30)
    expect(saves).toEqual(['first', 'second'])
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })

  it('page switch flush blocks on failed save', async () => {
    const controller = createAutosaveController({
      debounceMs: 10,
      onSave: async () => {
        throw new Error('fail')
      }
    })

    controller.notifyEdit('p1', 'content')
    await sleep(20)
    expect(controller.getState().status).toBe('error')

    const ok = await controller.flush()
    expect(ok).toBe(false)
    expect(controller.getState().status).toBe('error')

    controller.dispose()
  })

  it('page identity is associated with every pending save', async () => {
    const saves: Array<{ pageId: string; content: string }> = []
    const controller = createAutosaveController({
      debounceMs: 10,
      onSave: async (pageId, content) => {
        saves.push({ pageId, content })
      }
    })

    controller.notifyEdit('p1', 'content-a')
    await sleep(20)
    expect(saves[0].pageId).toBe('p1')

    controller.notifyEdit('p2', 'content-b')
    await sleep(20)
    expect(saves[1].pageId).toBe('p2')

    controller.dispose()
  })

  it('dispose cancels timers and prevents stale updates', async () => {
    const saves: string[] = []
    const controller = createAutosaveController({
      debounceMs: 10,
      onSave: async (_pageId, content) => {
        saves.push(content)
      }
    })

    controller.notifyEdit('p1', 'first')
    controller.dispose()
    await sleep(30)
    expect(saves.length).toBe(0)
    expect(controller.getState().status).toBe('dirty') // disposed, no further transitions
  })

  it('never claims saved until latest content confirmed', async () => {
    let saveCount = 0
    const controller = createAutosaveController({
      debounceMs: 10,
      onSave: async () => {
        saveCount++
        await sleep(15)
      }
    })

    controller.notifyEdit('p1', 'a')
    await sleep(15) // saving
    expect(controller.getState().status).toBe('saving')
    controller.notifyEdit('p1', 'b')
    expect(controller.getState().status).toBe('dirty')
    await sleep(40)
    expect(saveCount).toBe(2)
    expect(controller.getState().status).toBe('saved')

    controller.dispose()
  })
})
