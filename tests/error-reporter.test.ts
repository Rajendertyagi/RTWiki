import { afterAll, describe, expect, it } from 'bun:test'
import type { ClientErrorReport } from '../src/shared/schemas/client-error.js'
import { isHandled, markHandled, reportClientError } from '../src/web/diagnostics/error-reporter.js'

interface CapturedRequest {
  input: unknown
  init: RequestInit | undefined
}

const captured: CapturedRequest[] = []
const originalFetch = globalThis.fetch

// Install a fetch stub before importing nothing else — the reporter posts
// fire-and-forget, so captured requests are read synchronously after calls.
globalThis.fetch = (async (input: unknown, init?: RequestInit): Promise<Response> => {
  captured.push({ input, init })
  return new Response('{"ok":true}', { status: 200 })
}) as typeof fetch

afterAll(() => {
  globalThis.fetch = originalFetch
})

function lastReport(): ClientErrorReport {
  const last = captured[captured.length - 1]
  const body = String((last?.init?.body as string) ?? '{}')
  return JSON.parse(body) as ClientErrorReport
}

describe('frontend error reporter', () => {
  it('generates short hexadecimal correlation ids via getRandomValues', () => {
    const id = reportClientError('window_error', {
      component: 'UnitTest',
      error: new TypeError('probe')
    })
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('sends canned safe messages and never the raw error message', () => {
    reportClientError('rich_note_parse_error', {
      pageType: 'rich',
      component: 'ParseProbe',
      error: new Error('SECRET PAGE CONTENT leaked in parse message')
    })
    const report = lastReport()
    expect(report.event).toBe('rich_note_parse_error')
    expect(report.errorMessage).toBe('Stored Rich Note content could not be parsed.')
    expect(JSON.stringify(report)).not.toContain('SECRET PAGE CONTENT')
    expect(report.errorName).toBe('Error')
  })

  it('reduces stacks to a sanitized top-frame location', () => {
    const error = new RangeError('stack probe')
    reportClientError('unhandled_rejection', { component: 'StackProbe', error })
    const report = lastReport()
    if (report.stackLocation !== undefined) {
      expect(report.stackLocation.length).toBeLessThanOrEqual(200)
      expect(report.stackLocation).not.toMatch(/https?:\/\//)
      expect(report.stackLocation).not.toContain('(')
    }
  })

  it('reuses the first correlation id and stops posting after repeated failures', () => {
    const before = captured.length
    const firstId = reportClientError('react_error_boundary', { component: 'DedupeProbe' })
    reportClientError('react_error_boundary', { component: 'DedupeProbe' })
    reportClientError('react_error_boundary', { component: 'DedupeProbe' })
    const thirdId = reportClientError('react_error_boundary', { component: 'DedupeProbe' })

    // MAX_REPORTS_PER_KEY = 3 posts; the fourth is suppressed.
    expect(captured.length - before).toBe(3)
    expect(thirdId).toBe(firstId)

    // The suppressed repeat still surfaces the original id for the UI.
    const suppressed = reportClientError('react_error_boundary', { component: 'DedupeProbe' })
    expect(suppressed).toBe(firstId)
    expect(captured.length - before).toBe(3)
  })

  it('marks handled errors so global handlers can skip them', () => {
    const error = new Error('boundary caught me')
    expect(isHandled(error)).toBe(false)
    markHandled(error)
    expect(isHandled(error)).toBe(true)
    expect(isHandled(new Error('other'))).toBe(false)
    expect(isHandled(undefined)).toBe(false)
    expect(isHandled('string reason')).toBe(false)
  })
})
