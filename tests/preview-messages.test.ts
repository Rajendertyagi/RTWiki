import { describe, expect, it } from 'bun:test'
import { isValidPreviewMessage } from '../src/web/features/html/preview-messages.js'

const CHANNEL = 'a'.repeat(32)

describe('preview message validation', () => {
  it('accepts a valid ready message', () => {
    expect(
      isValidPreviewMessage({ type: 'rtwiki-preview-ready', channel: CHANNEL })
    ).toBe(true)
  })

  it('accepts a valid error message with sanitized fields', () => {
    expect(
      isValidPreviewMessage({
        type: 'rtwiki-preview-error',
        channel: CHANNEL,
        operation: 'runtime',
        errorName: 'TypeError'
      })
    ).toBe(true)
  })

  it('rejects unknown message types', () => {
    expect(isValidPreviewMessage({ type: 'rtwiki-preview-evil', channel: CHANNEL })).toBe(false)
  })

  it('rejects malformed or missing channel ids', () => {
    expect(isValidPreviewMessage({ type: 'rtwiki-preview-ready' })).toBe(false)
    expect(isValidPreviewMessage({ type: 'rtwiki-preview-ready', channel: 'short' })).toBe(false)
    expect(isValidPreviewMessage({ type: 'rtwiki-preview-ready', channel: 'Z'.repeat(32) })).toBe(
      false
    )
  })

  it('rejects unknown extra fields (strict schema)', () => {
    expect(
      isValidPreviewMessage({
        type: 'rtwiki-preview-ready',
        channel: CHANNEL,
        smuggled: 'payload'
      })
    ).toBe(false)
  })

  it('rejects non-object payloads', () => {
    expect(isValidPreviewMessage(null)).toBe(false)
    expect(isValidPreviewMessage('ready')).toBe(false)
    expect(isValidPreviewMessage(42)).toBe(false)
  })

  it('bounds optional field lengths', () => {
    expect(
      isValidPreviewMessage({
        type: 'rtwiki-preview-error',
        channel: CHANNEL,
        errorName: 'x'.repeat(121)
      })
    ).toBe(false)
  })
})
