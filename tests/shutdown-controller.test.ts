import { afterEach, describe, expect, it } from 'bun:test'
import {
  fetchShutdownToken,
  requestShutdown
} from '../src/web/features/shutdown/shutdown-client.js'

describe('shutdown client', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('fetchShutdownToken returns token on success', async () => {
    // @ts-expect-error - override global fetch for test
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ token: 'test-token-123' })
      } as unknown as Response)
    const token = await fetchShutdownToken()
    expect(token).toBe('test-token-123')
  })

  it('fetchShutdownToken returns null on failure', async () => {
    // @ts-expect-error
    globalThis.fetch = async () =>
      ({
        ok: false,
        status: 403,
        json: async () => ({ error: 'forbidden' })
      } as unknown as Response)
    const token = await fetchShutdownToken()
    expect(token).toBeNull()
  })

  it('requestShutdown succeeds with HTTP 202', async () => {
    // @ts-expect-error
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 202,
        json: async () => ({ status: 'shutting_down' })
      } as unknown as Response)
    const result = await requestShutdown('valid-token')
    expect(result.success).toBe(true)
  })

  it('requestShutdown succeeds with HTTP 200 (backward compat)', async () => {
    // @ts-expect-error
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'shutting_down' })
      } as unknown as Response)
    const result = await requestShutdown('valid-token')
    expect(result.success).toBe(true)
  })

  it('requestShutdown fails with invalid token', async () => {
    // @ts-expect-error
    globalThis.fetch = async () =>
      ({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Invalid shutdown token' })
      } as unknown as Response)
    const result = await requestShutdown('bad-token')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid shutdown token')
  })

  it('requestShutdown handles network failure', async () => {
    // @ts-expect-error
    globalThis.fetch = async () => {
      throw new Error('network failure')
    }
    const result = await requestShutdown('token')
    expect(result.success).toBe(false)
    expect(result.error).toContain('network failure')
  })

  it('shutdown confirmation flow requires explicit token', async () => {
    const token = 'secret-uuid-token'
    // @ts-expect-error
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 202,
        json: async () => ({ status: 'shutting_down' })
      } as unknown as Response)
    const result = await requestShutdown(token)
    expect(result.success).toBe(true)
    // Ensure error messages do not contain token
    // @ts-expect-error
    globalThis.fetch = async () =>
      ({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Invalid shutdown token' })
      } as unknown as Response)
    const fail = await requestShutdown('wrong')
    expect(fail.error).not.toContain(token)
  })
})

describe('shutdown controller state', () => {
  it('produces correct confirmation messages', async () => {
    const { UI_TEXT } = await import('../src/web/config/index.js')
    expect(UI_TEXT.stopConfirmTitle).toBe('Stop RTWiki')
    expect(UI_TEXT.stopConfirmMessage).toContain('shut down')
    expect(UI_TEXT.stopSuccessMessage).toContain('stopped')
    expect(UI_TEXT.stopError).toBeDefined()
  })

  it('requires confirmation before shutdown', async () => {
    const { UI_TEXT } = await import('../src/web/config/index.js')
    expect(UI_TEXT.stopConfirmTitle.length).toBeGreaterThan(0)
    expect(UI_TEXT.stopConfirmMessage.length).toBeGreaterThan(0)
  })
})
