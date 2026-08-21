import { describe, expect, it } from 'bun:test'
import { createDefaultDocument, parseStoredDocument, serializeDocument } from '../src/web/features/rich-editor/document.js'

describe('rich-editor document', () => {
  it('parses valid stored BlockNote JSON', () => {
    const doc = [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello', styles: {} }] }]
    const stored = JSON.stringify(doc)
    const result = parseStoredDocument(stored)
    expect(result.status).toBe('ok')
    expect(result.document).toEqual(doc)
    expect(result.originalValue).toBe(stored)
  })

  it('initializes empty Rich Note with default document', () => {
    const result = parseStoredDocument('')
    expect(result.status).toBe('empty')
    expect(result.document).not.toBeNull()
    expect(Array.isArray(result.document)).toBe(true)
    expect(result.document?.length).toBeGreaterThan(0)
    // whitespace-only also counts as empty
    const ws = parseStoredDocument('   \n\t')
    expect(ws.status).toBe('empty')
  })

  it('initializes empty array as empty document', () => {
    const result = parseStoredDocument('[]')
    expect(result.status).toBe('empty')
    expect(result.document).not.toBeNull()
  })

  it('preserves malformed non-empty content without overwriting', () => {
    const malformed = '{ not valid json'
    const result = parseStoredDocument(malformed)
    expect(result.status).toBe('error')
    expect(result.document).toBeNull()
    expect(result.originalValue).toBe(malformed)
    expect(result.errorMessage).toBeDefined()
  })

  it('preserves non-array JSON without overwriting', () => {
    const stored = JSON.stringify({ type: 'paragraph' })
    const result = parseStoredDocument(stored)
    expect(result.status).toBe('error')
    expect(result.document).toBeNull()
    expect(result.originalValue).toBe(stored)
  })

  it('preserves invalid block structure without overwriting', () => {
    const stored = JSON.stringify([{ notype: 'paragraph' }])
    const result = parseStoredDocument(stored)
    expect(result.status).toBe('error')
    expect(result.document).toBeNull()
  })

  it('round-trips valid document through serialize', () => {
    const doc = [{ type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Title', styles: {} }] }]
    const serialized = serializeDocument(doc as never)
    const reparsed = parseStoredDocument(serialized)
    expect(reparsed.status).toBe('ok')
    expect(reparsed.document).toEqual(doc)
  })

  it('saved content reload reproduces same document', () => {
    const original = [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved content', styles: { bold: true } }] }]
    const stored = JSON.stringify(original)
    const parsed = parseStoredDocument(stored)
    expect(parsed.status).toBe('ok')
    const reserialized = serializeDocument(parsed.document as never)
    const reloaded = parseStoredDocument(reserialized)
    expect(reloaded.document).toEqual(original)
  })

  it('createDefaultDocument returns independent copies', () => {
    const a = createDefaultDocument()
    const b = createDefaultDocument()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    // Mutating one does not affect the other
    ;(a[0] as Record<string, unknown>).type = 'heading'
    expect(b[0].type).toBe('paragraph')
  })
})
