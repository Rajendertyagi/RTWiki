import { describe, expect, it } from 'bun:test'
import {
  ACCEPTED_IMAGE_FORMATS,
  detectImageFormat,
  IMAGE_FILE_ACCEPT_ATTRIBUTE
} from '../src/shared/attachments/image-formats.js'

/** Builds a byte array from a latin-1 string, for readable fixtures. */
function bytes(text: string, padTo = 32): Uint8Array {
  const out = new Uint8Array(padTo)
  for (let i = 0; i < text.length && i < padTo; i += 1) out[i] = text.charCodeAt(i)
  return out
}

const PNG_HEADER = '\x89PNG\r\n\x1a\n'

describe('image format detection', () => {
  it('recognises each accepted format from its own bytes', () => {
    expect(detectImageFormat(bytes(PNG_HEADER))?.mime).toBe('image/png')
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg')
    expect(detectImageFormat(bytes('GIF89a'))?.mime).toBe('image/gif')
    expect(detectImageFormat(bytes('GIF87a'))?.mime).toBe('image/gif')
    expect(detectImageFormat(bytes('RIFF____WEBP'))?.mime).toBe('image/webp')
    expect(detectImageFormat(new Uint8Array([0x42, 0x4d, 0x00, 0x00]))?.mime).toBe('image/bmp')
  })

  it('rejects content that is not an accepted image', () => {
    // The important cases: markup and executables, whatever they claim to be.
    expect(detectImageFormat(bytes('<html><script>alert(1)</script>'))).toBeNull()
    expect(detectImageFormat(bytes('<?xml version="1.0"?><svg onload="alert(1)"/>'))).toBeNull()
    expect(detectImageFormat(bytes('MZ\x90\x00'))).toBeNull() // PE executable
    expect(detectImageFormat(bytes('%PDF-1.7'))).toBeNull()
    expect(detectImageFormat(bytes('#!/bin/sh\nrm -rf /'))).toBeNull()
    expect(detectImageFormat(new Uint8Array(0))).toBeNull()
  })

  it('rejects content too short to carry a signature', () => {
    // Guards a detector that indexes past the end of a truncated upload.
    expect(detectImageFormat(new Uint8Array([0x89]))).toBeNull()
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8]))).toBeNull()
    expect(detectImageFormat(bytes('RIFF', 4))).toBeNull()
  })

  it('never accepts SVG, which can carry script', () => {
    // Serving SVG inline would be document execution, which the security model
    // forbids for uploaded content.
    const svg = bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>', 64)
    expect(detectImageFormat(svg)).toBeNull()
    expect(ACCEPTED_IMAGE_FORMATS.map((f) => f.mime)).not.toContain('image/svg+xml')
  })

  it('does not confuse a RIFF container that is not WEBP', () => {
    // RIFF also fronts WAV and AVI. Only WEBP may be accepted.
    expect(detectImageFormat(bytes('RIFF____WAVE'))).toBeNull()
  })

  it('publishes an accept attribute drawn from the same list', () => {
    // The picker and the server must not be able to disagree, so the attribute is
    // derived from the formats rather than written out separately.
    const expected = ACCEPTED_IMAGE_FORMATS.map((f) => f.mime).join(',')
    expect(IMAGE_FILE_ACCEPT_ATTRIBUTE).toBe(expected)
  })
})
