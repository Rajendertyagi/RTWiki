import { describe, expect, it } from 'bun:test'
import {
  type DamageResponse,
  evaluateDamage,
  isTextDamageFormat
} from '../scripts/ci/damage-rule.js'

function response(overrides: Partial<DamageResponse> = {}): DamageResponse {
  return {
    status: 201,
    body: '{"attachment":{"id":"a1"}}',
    damage: 'flip',
    formatExt: 'xlsx',
    extractedText: 'MARKER1 photosynthesis garbled \uFFFD text',
    storedMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    expectedMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ...overrides
  }
}

describe('damage rule', () => {
  it('treats RTF as a text format, like txt/md/html', () => {
    expect(isTextDamageFormat('rtf')).toBe(true)
    expect(isTextDamageFormat('txt')).toBe(true)
    expect(isTextDamageFormat('xlsx')).toBe(false)
  })

  it('passes a truncated or flipped RTF accepted with text', () => {
    for (const damage of ['truncate', 'flip'] as const) {
      const verdict = evaluateDamage(response({ formatExt: 'rtf', damage }))
      expect(verdict.pass, damage).toBe(true)
      expect(verdict.reason, damage).toContain('accepted')
    }
  })

  it('passes a damaged container the library accepted without a warning', () => {
    // The exact case that used to fail: markers survive in garbled text.
    for (const damage of ['truncate', 'flip'] as const) {
      const verdict = evaluateDamage(response({ damage }))
      expect(verdict.pass, damage).toBe(true)
      expect(verdict.reason, damage).toContain('accepted by library')
    }
  })

  it('still refuses a plain zip that is not a document', () => {
    const verdict = evaluateDamage(
      response({
        damage: 'plainzip',
        status: 415,
        body: '{"error":"That document could not be opened."}'
      })
    )
    expect(verdict.pass).toBe(true)
    expect(verdict.reason).toContain('could not be opened')
  })

  it('fails a plain zip the app wrongly accepted', () => {
    const verdict = evaluateDamage(response({ damage: 'plainzip', status: 201 }))
    expect(verdict.pass).toBe(false)
  })

  it('accepts a meaningful refusal but rejects a meaningless one', () => {
    expect(
      evaluateDamage(
        response({ status: 415, body: '{"error":"This file is password-protected."}' })
      ).pass
    ).toBe(true)
    expect(evaluateDamage(response({ status: 415, body: '{"error":"Nope"}' })).pass).toBe(false)
  })

  it('keeps the wrong-extension rule: bytes must be stored under their real type', () => {
    expect(
      evaluateDamage(
        response({
          damage: 'wrongext',
          storedMimeType: 'application/pdf',
          expectedMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        })
      ).pass
    ).toBe(false)
    expect(
      evaluateDamage(
        response({
          damage: 'wrongext',
          storedMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        })
      ).pass
    ).toBe(true)
  })

  it('fails a hang', () => {
    expect(evaluateDamage(response({ status: 0 })).pass).toBe(false)
  })

  it('applies the plainzip rule to text formats too', () => {
    // A plain zip is never a document, whatever extension it arrived with.
    expect(
      evaluateDamage(
        response({
          formatExt: 'txt',
          damage: 'plainzip',
          status: 415,
          body: '{"error":"Nope"}'
        })
      ).pass
    ).toBe(false)
    expect(
      evaluateDamage(
        response({
          formatExt: 'txt',
          damage: 'plainzip',
          status: 415,
          body: '{"error":"That document could not be opened."}'
        })
      ).pass
    ).toBe(true)
  })

  it('applies the wrongext stored-type rule to text formats too', () => {
    expect(
      evaluateDamage(
        response({
          formatExt: 'txt',
          damage: 'wrongext',
          storedMimeType: 'application/pdf',
          expectedMime: 'text/plain'
        })
      ).pass
    ).toBe(false)
  })

  it('requires a meaningful 4xx for text formats too', () => {
    expect(
      evaluateDamage(
        response({ formatExt: 'md', damage: 'flip', status: 415, body: '{"error":"Nope"}' })
      ).pass
    ).toBe(false)
  })
})
