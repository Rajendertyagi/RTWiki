import { describe, expect, it } from 'bun:test'
import {
  ImportErrorCode,
  ImportRequestSchema,
  importErrorCodeFromIssue
} from '../src/shared/schemas/import.js'

describe('ImportRequestSchema', () => {
  it('accepts a file source', () => {
    const parsed = ImportRequestSchema.safeParse({
      source: { kind: 'file' },
      fileName: 'notes.md'
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.source.kind).toBe('file')
      expect(parsed.data.createPage).toBe(true)
    }
  })

  it('rejects paste and api sources with the unsupported_source code', () => {
    for (const kind of ['paste', 'api']) {
      const parsed = ImportRequestSchema.safeParse({
        source: { kind },
        fileName: 'notes.md'
      })
      expect(parsed.success).toBe(false)
      if (!parsed.success) {
        const codes = parsed.error.issues
          .map((issue) => importErrorCodeFromIssue(issue))
          .filter((code) => code !== null)
        expect(codes).toContain('unsupported_source')
      }
    }
  })

  it('rejects an unknown source kind as a plain field error', () => {
    const parsed = ImportRequestSchema.safeParse({
      source: { kind: 'carrier-pigeon' },
      fileName: 'notes.md'
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const codes = parsed.error.issues
        .map((issue) => importErrorCodeFromIssue(issue))
        .filter((code) => code !== null)
      expect(codes).not.toContain('unsupported_source')
    }
  })

  it('requires a non-empty file name', () => {
    const parsed = ImportRequestSchema.safeParse({ source: { kind: 'file' }, fileName: '' })
    expect(parsed.success).toBe(false)
  })
})

describe('ImportErrorCode', () => {
  it('contains every code the server and client share', () => {
    expect(ImportErrorCode).toEqual([
      'wrong_media_type',
      'too_large',
      'forbidden',
      'no_file',
      'empty',
      'unsupported_source',
      'invalid_field',
      'text_too_long',
      'unsupported_type',
      'svg_not_supported',
      'too_many_pixels',
      'extract_failed',
      'legacy_office',
      'password_protected',
      'conversion_failed',
      'parent_not_found',
      'internal'
    ])
  })

  it('is a const tuple usable as a type', () => {
    const code: (typeof ImportErrorCode)[number] = 'conversion_failed'
    expect(code).toBe('conversion_failed')
  })
})
