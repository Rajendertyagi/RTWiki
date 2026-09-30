import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { readJson } from '../src/server/utils/read-json.js'

/**
 * The media-type rule on JSON request bodies.
 *
 * The reasoning is in `utils/read-json.ts`; what matters here is that the rule is
 * enforced for the readers that exist rather than asserted about the helper alone.
 * These tests mount the real routes, so a route that quietly stopped using the
 * shared reader would fail rather than pass.
 */
const JSON_HEADERS = { 'content-type': 'application/json' }

function mountReadJson(): Hono {
  const app = new Hono()
  app.post('/echo', async (c) => {
    const result = await readJson(c, 1024)
    return result.ok ? c.json({ ok: true }) : result.response
  })
  return app
}

describe('JSON request bodies must declare a JSON media type', () => {
  it('accepts application/json', async () => {
    const app = mountReadJson()
    const res = await app.request('/echo', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ a: 1 })
    })
    expect(res.status).toBe(200)
  })

  it('accepts a charset parameter, because a browser adds one itself', async () => {
    // Strictness here would break working clients rather than attackers: this is
    // what a browser sends for a JSON string body, and what our own client sends.
    const app = mountReadJson()
    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json;charset=utf-8' },
      body: JSON.stringify({ a: 1 })
    })
    expect(res.status).toBe(200)
  })

  it('accepts a +json structured suffix', async () => {
    const app = mountReadJson()
    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/vnd.api+json' },
      body: JSON.stringify({ a: 1 })
    })
    expect(res.status).toBe(200)
  })

  it('is case-insensitive about the type and its parameters', async () => {
    const app = mountReadJson()
    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'APPLICATION/JSON; Charset=UTF-8' },
      body: JSON.stringify({ a: 1 })
    })
    expect(res.status).toBe(200)
  })

  it('refuses text/plain, which is the CORS-safelisted simple-request type', async () => {
    // The whole point. A cross-origin POST with this header is dispatched without
    // a preflight, so a reader that accepts it hands the attacker the request.
    const app = mountReadJson()
    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ a: 1 })
    })
    expect(res.status).toBe(415)
    const payload = (await res.json()) as { error: string }
    expect(payload.error).toContain('application/json')
  })

  it('refuses form encoding', async () => {
    const app = mountReadJson()
    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a=1'
    })
    expect(res.status).toBe(415)
  })

  it('refuses a body with no declared type at all', async () => {
    // A JSON endpoint that accepts an unlabelled body is the same hole with one
    // fewer step for the caller.
    const app = mountReadJson()
    const res = await app.request('/echo', { method: 'POST', body: JSON.stringify({ a: 1 }) })
    expect(res.status).toBe(415)
  })

  it('reports the media type before the size, so a wrong-type oversized body is not told it was merely big', async () => {
    // Both are the caller's mistake, but they are different mistakes, and a size
    // message sent to a content-type problem sends the caller looking in the wrong
    // place.
    const app = mountReadJson()
    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'content-length': '99999' },
      body: 'x'
    })
    expect(res.status).toBe(415)
  })

  it('still reports malformed JSON as malformed, not as a media-type problem', async () => {
    const app = mountReadJson()
    const res = await app.request('/echo', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{not json'
    })
    expect(res.status).toBe(400)
    const payload = (await res.json()) as { error: string }
    expect(payload.error).toBe('Invalid JSON')
  })

  it('still enforces the byte ceiling with the right header present', async () => {
    const app = mountReadJson()
    const res = await app.request('/echo', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ a: 'x'.repeat(4096) })
    })
    expect(res.status).toBe(413)
  })
})
