import { describe, expect, it } from 'bun:test'
import {
  DebugEventBatchSchema,
  DebugEventSchema,
  debugEventCategory
} from '../src/shared/schemas/debug-events.js'

function validEvent(): Record<string, unknown> {
  return {
    ts: Date.now(),
    cat: 'autosave',
    evt: 'autosave_success',
    pageId: '0f0a7c1e-8d21-4c9a-b2e3-5f6a7b8c9d01',
    rev: 3,
    len: 120
  }
}

describe('debug event schema', () => {
  it('accepts a fully-formed allowlisted event', () => {
    const parsed = DebugEventSchema.safeParse(validEvent())
    expect(parsed.success).toBe(true)
  })

  it('rejects unknown fields instead of stripping them', () => {
    const parsed = DebugEventSchema.safeParse({
      ...validEvent(),
      pageTitle: 'SECRET TITLE',
      evil: { nested: 'arbitrary' }
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects event names outside the allowlist', () => {
    const parsed = DebugEventSchema.safeParse({ ...validEvent(), evt: 'not_a_real_event' })
    expect(parsed.success).toBe(false)
  })

  it('rejects an event whose name belongs to another category', () => {
    const parsed = DebugEventSchema.safeParse({ ...validEvent(), cat: 'ui' })
    expect(parsed.success).toBe(false)
  })

  it('rejects non-numeric or negative lengths/revisions', () => {
    expect(DebugEventSchema.safeParse({ ...validEvent(), len: -1 }).success).toBe(false)
    expect(DebugEventSchema.safeParse({ ...validEvent(), rev: 1.5 }).success).toBe(false)
  })

  it('enforces the safe hash alphabet (8 lowercase hex chars)', () => {
    expect(DebugEventSchema.safeParse({ ...validEvent(), hash: 'deadbeef' }).success).toBe(true)
    expect(DebugEventSchema.safeParse({ ...validEvent(), hash: 'DEADBEEF' }).success).toBe(false)
    expect(DebugEventSchema.safeParse({ ...validEvent(), hash: 'deadbeeff' }).success).toBe(false)
    expect(DebugEventSchema.safeParse({ ...validEvent(), hash: '<script>' }).success).toBe(false)
  })

  it('rejects free-text error codes', () => {
    expect(DebugEventSchema.safeParse({ ...validEvent(), code: 'ok' }).success).toBe(true)
    expect(DebugEventSchema.safeParse({ ...validEvent(), code: 'some free text!' }).success).toBe(
      false
    )
  })

  it('rejects ids outside the bounded token alphabet', () => {
    const parsed = DebugEventSchema.safeParse({ ...validEvent(), pageId: 'bad id!!' })
    expect(parsed.success).toBe(false)
  })

  it('maps every allowlisted event name to exactly one category', () => {
    expect(debugEventCategory('autosave_success')).toBe('autosave')
    expect(debugEventCategory('ui_drag_drop')).toBe('ui')
    expect(debugEventCategory('nav_session_restored')).toBe('navigation')
    expect(debugEventCategory('preview_iframe_ready')).toBe('preview')
    expect(debugEventCategory('editor_stale_update_rejected')).toBe('editor')
    expect(debugEventCategory('error_api_failure')).toBe('error')
  })

  it('accepts the visual-block render lifecycle events', () => {
    const base = { ts: Date.now(), cat: 'editor' as const }
    expect(
      DebugEventSchema.safeParse({ ...base, evt: 'editor_block_render_requested', len: 42 }).success
    ).toBe(true)
    expect(
      DebugEventSchema.safeParse({
        ...base,
        evt: 'editor_block_render_succeeded',
        result: 'ok',
        durMs: 12
      }).success
    ).toBe(true)
    expect(
      DebugEventSchema.safeParse({
        ...base,
        evt: 'editor_block_render_failed',
        result: 'error',
        code: 'diagram'
      }).success
    ).toBe(true)
  })
})

describe('debug event batch schema', () => {
  function validBatch(eventCount: number): Record<string, unknown> {
    return {
      session: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      events: Array.from({ length: eventCount }, () => validEvent())
    }
  }

  it('accepts a valid batch', () => {
    expect(DebugEventBatchSchema.safeParse(validBatch(3)).success).toBe(true)
  })

  it('rejects empty batches', () => {
    expect(DebugEventBatchSchema.safeParse(validBatch(0)).success).toBe(false)
  })

  it('rejects batches above the hard event-count bound', () => {
    expect(DebugEventBatchSchema.safeParse(validBatch(101)).success).toBe(false)
  })

  it('rejects unknown envelope fields', () => {
    const batch = validBatch(1) as Record<string, unknown>
    batch.userAgent = 'Mozilla/5.0 secret fingerprint'
    expect(DebugEventBatchSchema.safeParse(batch).success).toBe(false)
  })
})
