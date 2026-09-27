import { describe, expect, it } from 'bun:test'
import {
  ACCEPTED_IMAGE_FORMATS,
  ACCEPTED_IMAGE_MIME_TYPES,
  acceptedImageFormatFor,
  IMAGE_FILE_ACCEPT_ATTRIBUTE
} from '../src/shared/attachments/image-formats.js'

/**
 * The allowlist is the policy, so these tests are about the policy: which
 * formats are on it, that the derived client values come from it, and that a
 * detected type only becomes a stored type by passing through here.
 *
 * Byte-level detection is tested in `image-detect.test.ts`.
 */
describe('accepted image formats', () => {
  it('accepts the formats a current browser can draw', () => {
    expect(ACCEPTED_IMAGE_MIME_TYPES).toEqual([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/avif',
      'image/bmp'
    ])
  })

  it('gives every format an extension we chose', () => {
    // JPEG is the one deliberate exception: its type is `image/jpeg` while the
    // file everyone actually writes is `.jpg`.
    const expected: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/avif': 'avif',
      'image/bmp': 'bmp'
    }
    for (const format of ACCEPTED_IMAGE_FORMATS) {
      expect(format.ext).toBe(expected[format.mime])
    }
  })

  it('has no duplicate types', () => {
    const all = ACCEPTED_IMAGE_FORMATS.map((f) => f.mime)
    expect(new Set(all).size).toBe(all.length)
  })

  it('refuses SVG, which can carry scripts (ADR-013)', () => {
    expect(ACCEPTED_IMAGE_MIME_TYPES).not.toContain('image/svg+xml')
    expect(acceptedImageFormatFor('image/svg+xml')).toBeNull()
    expect(acceptedImageFormatFor('image/svg')).toBeNull()
  })

  it('refuses formats no mainstream browser renders in an <img>', () => {
    // Detected happily by file-type, but a note containing one would show a
    // broken image rather than the picture the user pasted.
    expect(acceptedImageFormatFor('image/tiff')).toBeNull()
    expect(acceptedImageFormatFor('image/heic')).toBeNull()
    expect(acceptedImageFormatFor('image/jxl')).toBeNull()
  })

  it('refuses a type that is not an image at all', () => {
    expect(acceptedImageFormatFor('application/pdf')).toBeNull()
    expect(acceptedImageFormatFor('application/zip')).toBeNull()
    expect(acceptedImageFormatFor('application/x-msdownload')).toBeNull()
  })

  it('refuses an absent type rather than defaulting to one', () => {
    expect(acceptedImageFormatFor(null)).toBeNull()
    expect(acceptedImageFormatFor(undefined)).toBeNull()
    expect(acceptedImageFormatFor('')).toBeNull()
  })

  it('maps a detected type to the format we store', () => {
    expect(acceptedImageFormatFor('image/png')?.ext).toBe('png')
    expect(acceptedImageFormatFor('image/jpeg')?.ext).toBe('jpg')
    expect(acceptedImageFormatFor('image/avif')?.ext).toBe('avif')
  })
})

describe('client-facing accept attribute', () => {
  it('is derived from the same list, so the picker cannot drift from the server', () => {
    expect(IMAGE_FILE_ACCEPT_ATTRIBUTE).toBe(ACCEPTED_IMAGE_MIME_TYPES.join(','))
  })

  it('never offers a format the server would refuse', () => {
    for (const mime of IMAGE_FILE_ACCEPT_ATTRIBUTE.split(',')) {
      expect(acceptedImageFormatFor(mime)).not.toBeNull()
    }
  })
})
