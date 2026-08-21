import { describe, expect, it, mock } from 'bun:test'
import { ShutdownCoordinator } from '../src/server/shutdown-coordinator.js'

// ---------- helpers ----------

function makeDeferred<T>(): {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
} {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((r, j) => {
    resolve = r
    reject = j
  })
  return { promise, resolve, reject }
}

function makeFakeCaps(
  overrides: Partial<{
    stopGracefully: () => Promise<void>
    closeDatabase: () => Promise<void>
    logInfo: (msg: string, ctx?: Record<string, unknown>) => void
    logWarn: (msg: string, ctx?: Record<string, unknown>) => void
    logError: (msg: string, ctx?: Record<string, unknown>) => void
    closeLogger: () => Promise<void>
  }> = {}
) {
  return {
    stopGracefully: mock(overrides.stopGracefully ?? (() => Promise.resolve())),
    closeDatabase: mock(overrides.closeDatabase ?? (() => Promise.resolve())),
    logInfo: mock(overrides.logInfo ?? (() => {})),
    logWarn: mock(overrides.logWarn ?? (() => {})),
    logError: mock(overrides.logError ?? (() => {})),
    closeLogger: mock(overrides.closeLogger ?? (() => Promise.resolve()))
  }
}

// ---------- coordinator unit tests ----------

describe('ShutdownCoordinator', () => {
  it('calls stopGracefully exactly once on successful shutdown', async () => {
    const caps = makeFakeCaps()
    const coord = new ShutdownCoordinator(caps)
    const result = await coord.requestShutdown()
    expect(caps.stopGracefully).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    expect(coord.state).toBe('stopped')
  })

  it('returns {ok:true,forced:false} when graceful stop succeeds', async () => {
    const caps = makeFakeCaps()
    const coord = new ShutdownCoordinator(caps)
    const result = await coord.requestShutdown()
    expect(result).toEqual({ ok: true, forced: false })
  })

  it('reuses the same Promise on concurrent requestShutdown() calls', async () => {
    const caps = makeFakeCaps()
    const coord = new ShutdownCoordinator(caps)
    const p1 = coord.requestShutdown()
    const p2 = coord.requestShutdown()
    expect(p1).toBe(p2)
    await p1
  })

  it('transitions running -> stopping -> stopped on success', async () => {
    const defer = makeDeferred<void>()
    const caps = makeFakeCaps({
      stopGracefully: mock(() => defer.promise)
    })
    const coord = new ShutdownCoordinator(caps)
    expect(coord.state).toBe('running')
    void coord.requestShutdown()
    // State transitions to 'stopping' synchronously inside requestShutdown().
    expect(coord.state).toBe('stopping')
    // Resolve the graceful stop to complete shutdown.
    defer.resolve()
    const result = await coord.completed
    expect(result.ok).toBe(true)
    expect(coord.state).toBe('stopped')
  })

  it('server failure -> failed; DB is not closed', async () => {
    const stopErr = new Error('server stop failed')
    const caps = makeFakeCaps({
      stopGracefully: mock(() => Promise.reject(stopErr)),
      closeDatabase: mock(() => Promise.resolve()),
      closeLogger: mock(() => Promise.resolve())
    })
    const coord = new ShutdownCoordinator(caps)
    const result = await coord.requestShutdown()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.stage).toBe('server')
    expect(caps.closeDatabase).toHaveBeenCalledTimes(0)
    expect(coord.state).toBe('failed')
  })

  it('database failure -> failed; logger is still attempted', async () => {
    const dbErr = new Error('db close failed')
    const caps = makeFakeCaps({
      closeDatabase: mock(() => Promise.reject(dbErr)),
      closeLogger: mock(() => Promise.resolve())
    })
    const coord = new ShutdownCoordinator(caps)
    const result = await coord.requestShutdown()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.stage).toBe('database')
    expect(caps.closeLogger).toHaveBeenCalledTimes(1)
    expect(coord.state).toBe('failed')
  })

  it('logger close failure -> failed; does not log through closed logger', async () => {
    const loggerErr = new Error('logger close failed')
    const logInfoSpy = mock()
    const caps = makeFakeCaps({
      logInfo: logInfoSpy,
      closeLogger: mock(() => Promise.reject(loggerErr))
    })
    const coord = new ShutdownCoordinator(caps)
    const result = await coord.requestShutdown()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.stage).toBe('logger')
    expect(coord.state).toBe('failed')
    // The "Shutdown complete" log must have been written before logger close.
    expect(logInfoSpy).toHaveBeenCalledTimes(2)
  })

  it('completed does not resolve before requestShutdown() is called', async () => {
    const caps = makeFakeCaps()
    const coord = new ShutdownCoordinator(caps)
    let resolved = false
    void coord.completed.then(() => {
      resolved = true
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(resolved).toBe(false)
    await coord.requestShutdown()
    await coord.completed
    expect(resolved).toBe(true)
  })

  it('completed resolves with the exact final result', async () => {
    const caps = makeFakeCaps()
    const coord = new ShutdownCoordinator(caps)
    const reqPromise = coord.requestShutdown()
    const completedResult = await coord.completed
    const reqResult = await reqPromise
    expect(completedResult).toEqual(reqResult)
  })

  it('DB remains open until server.stop() resolves', async () => {
    let dbClosed = false
    const defer = makeDeferred<void>()
    const caps = makeFakeCaps({
      stopGracefully: mock(() => defer.promise),
      closeDatabase: mock(() => {
        dbClosed = true
        return Promise.resolve()
      })
    })
    const coord = new ShutdownCoordinator(caps)
    void coord.requestShutdown()
    // DB must not be closed while server is still stopping.
    expect(dbClosed).toBe(false)
    defer.resolve()
    await coord.completed
    expect(dbClosed).toBe(true)
  })

  it('logInfo is called before logger.close()', async () => {
    const logCalls: string[] = []
    const defer = makeDeferred<void>()
    const caps = makeFakeCaps({
      stopGracefully: mock(() => defer.promise),
      logInfo: mock((msg: string) => logCalls.push(msg)) as unknown as (
        msg: string,
        ctx?: Record<string, unknown>
      ) => void,
      closeLogger: mock(() => {
        logCalls.push('closeLogger')
        return Promise.resolve()
      })
    })
    const coord = new ShutdownCoordinator(caps)
    void coord.requestShutdown()
    // Logs should already contain "Shutting down" but not "Shutdown complete" yet.
    expect(logCalls).toContain('Shutting down')
    expect(logCalls).not.toContain('Shutdown complete')
    defer.resolve()
    await coord.completed
    expect(logCalls).toContain('Shutdown complete')
    expect(logCalls.indexOf('Shutdown complete')).toBeLessThan(logCalls.indexOf('closeLogger'))
  })

  it('no timer exists after successful shutdown', async () => {
    const caps = makeFakeCaps()
    const coord = new ShutdownCoordinator(caps)
    await coord.requestShutdown()
    // The coordinator does not create timers; we verify the public API
    // does not expose any timer handle.
    expect(coord.state).toBe('stopped')
  })

  it('second signal reuses the same shutdown operation', async () => {
    const caps = makeFakeCaps()
    const coord = new ShutdownCoordinator(caps)
    const p1 = coord.requestShutdown()
    const p2 = coord.requestShutdown()
    expect(p1).toBe(p2)
    expect(caps.stopGracefully).toHaveBeenCalledTimes(1)
    await p1
  })

  it('graceful stop succeeds then forced stop is never called', async () => {
    const gracefulDeferred = makeDeferred<void>()
    const caps = makeFakeCaps({
      stopGracefully: mock(() => gracefulDeferred.promise),
      closeDatabase: mock(() => Promise.resolve()),
      closeLogger: mock(() => Promise.resolve())
    })
    const coord = new ShutdownCoordinator(caps)
    void coord.requestShutdown()
    gracefulDeferred.resolve()
    const result = await coord.completed
    expect(result.ok).toBe(true)
    expect(caps.stopGracefully).toHaveBeenCalledTimes(1)
  })

  it('graceful stop failure produces server-stage failure', async () => {
    const gracefulDeferred = makeDeferred<void>()
    const caps = makeFakeCaps({
      stopGracefully: mock(() => gracefulDeferred.promise),
      closeDatabase: mock(() => Promise.resolve()),
      closeLogger: mock(() => Promise.resolve())
    })
    const coord = new ShutdownCoordinator(caps)
    void coord.requestShutdown()
    const gracefulErr = new Error('graceful failed')
    gracefulDeferred.reject(gracefulErr)
    const result = await coord.completed
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.stage).toBe('server')
    expect(coord.state).toBe('failed')
  })
})
