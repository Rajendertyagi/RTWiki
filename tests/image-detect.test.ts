import { describe, expect, it } from 'bun:test'
import { inspectImageUpload, pixelCount } from '../src/server/attachments/image-detect.js'
import {
  ACCEPTED_IMAGE_FORMATS,
  acceptedImageFormatFor
} from '../src/shared/attachments/image-formats.js'

/** A real, valid 1x1 PNG. Detection reads structure, so the test uses a real image. */
const REAL_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
)

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function bytes(text: string, padTo = 64): Uint8Array {
  const out = new Uint8Array(padTo)
  for (let i = 0; i < text.length && i < padTo; i += 1) out[i] = text.charCodeAt(i)
  return out
}

const text = (s: string) => new TextEncoder().encode(s)

/** A PNG signature followed by caller-chosen content. */
function pngThen(content: Uint8Array, totalLength = 8192): Uint8Array {
  const out = new Uint8Array(Math.max(totalLength, PNG_SIGNATURE.length + content.length))
  out.set(PNG_SIGNATURE, 0)
  out.set(content, PNG_SIGNATURE.length)
  return out
}

describe('image upload inspection', () => {
  it('accepts a real PNG and reads its dimensions from the header', async () => {
    const result = await inspectImageUpload(REAL_PNG)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format.mime).toBe('image/png')
    expect(result.width).toBe(1)
    expect(result.height).toBe(1)
  })

  it('accepts a bare JPEG start-of-image marker', async () => {
    const result = await inspectImageUpload(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.format.mime).toBe('image/jpeg')
  })

  it('rejects an SVG and says so, so the user learns the actual reason', async () => {
    const result = await inspectImageUpload(
      text(
        '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
      )
    )
    expect(result).toEqual({ ok: false, reason: 'svg_not_supported' })
  })

  it('recognises an SVG however it is written', async () => {
    // Detection alone cannot do this: an SVG is XML text, and `file-type`
    // reports it as `application/xml` or as nothing at all. Each of these must
    // still produce the specific message rather than a generic refusal.
    const variants: Array<[string, Uint8Array]> = [
      [
        'with an XML declaration',
        text('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')
      ],
      ['with no declaration at all', text('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')],
      [
        'with a DOCTYPE',
        text(
          '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg/>'
        )
      ],
      [
        'with an event handler',
        text('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
      ],
      [
        'after a UTF-8 BOM',
        new Uint8Array([0xef, 0xbb, 0xbf, ...text('<svg xmlns="http://www.w3.org/2000/svg"/>')])
      ]
    ]
    for (const [name, bytes] of variants) {
      expect(await inspectImageUpload(bytes), name).toEqual({
        ok: false,
        reason: 'svg_not_supported'
      })
    }
  })

  it('does not mistake other XML for an SVG', async () => {
    // A false positive would only change the message, never the outcome, but the
    // message should still be right.
    const result = await inspectImageUpload(
      text('<?xml version="1.0"?><note><body>study notes</body></note>')
    )
    expect(result).toEqual({ ok: false, reason: 'unsupported_type' })
  })

  it('accepts a GIF signature, reading no dimensions from a headerless GIF', async () => {
    // A GIF's dimensions live in a logical-screen descriptor that these bytes do
    // not contain, so the format is accepted and the dimensions are unknown. That
    // is the intended behaviour: the pixel limit does not fire on a size it
    // could not determine.
    const result = await inspectImageUpload(bytes('GIF89a'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format.mime).toBe('image/gif')
    expect(result.width).toBe(0)
    expect(result.height).toBe(0)
  })

  describe('refuses a valid signature followed by hostile content', () => {
    // This is the case a byte-signature comparison gets wrong: the leading bytes
    // match, so a signature check accepts, and the file is then stored and served
    // as image/png no matter what the rest of it contains.
    it('PNG signature then a script tag', async () => {
      const result = await inspectImageUpload(
        pngThen(text('<script>alert(document.domain)</script>'))
      )
      expect(result).toEqual({ ok: false, reason: 'unsupported_type' })
    })

    it('PNG signature then zeroes', async () => {
      const result = await inspectImageUpload(pngThen(new Uint8Array(512)))
      expect(result).toEqual({ ok: false, reason: 'unsupported_type' })
    })

    it('PNG signature and nothing else', async () => {
      const result = await inspectImageUpload(new Uint8Array(PNG_SIGNATURE))
      expect(result).toEqual({ ok: false, reason: 'unsupported_type' })
    })

    it('PNG signature then an IHDR of the wrong length', async () => {
      const fake = pngThen(new Uint8Array(4096))
      // A real IHDR is exactly 13 bytes; 99 is not, so this is not a PNG.
      new DataView(fake.buffer).setUint32(8, 99)
      fake.set(text('IHDR'), 12)
      const result = await inspectImageUpload(fake)
      expect(result).toEqual({ ok: false, reason: 'unsupported_type' })
    })
  })

  it('rejects non-images outright', async () => {
    for (const sample of [
      ['HTML with a script', text('<html><body><script>alert(1)</script></body></html>')],
      ['a PDF', text('%PDF-1.7')],
      ['a Windows executable', new Uint8Array([0x4d, 0x5a, 0x90, 0x00])],
      ['a shell script', text('#!/bin/sh\nrm -rf /')],
      ['a ZIP', new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
      ['nothing at all', new Uint8Array(0)],
      ['one byte', new Uint8Array([0x89])],
      ['two JPEG bytes', new Uint8Array([0xff, 0xd8])]
    ] as Array<[string, Uint8Array]>) {
      const result = await inspectImageUpload(sample[1])
      expect(result.ok, `${sample[0]} must be refused`).toBe(false)
    }
  })

  it('rejects a RIFF container that is not WebP', async () => {
    // RIFF alone is not enough: a WAV or AVI must not be taken for a WebP.
    const wav = new Uint8Array(64)
    wav.set(text('RIFF'), 0)
    wav.set(text('WAVE'), 8)
    const result = await inspectImageUpload(wav)
    expect(result.ok).toBe(false)
  })

  it('refuses a detected type that is not on the allowlist', async () => {
    // Guards the seam between detection and policy: detection may report more
    // types than we accept, and the allowlist must be what decides.
    const detectedButNotAccepted = 'image/tiff'
    expect(acceptedImageFormatFor(detectedButNotAccepted)).toBeNull()
    expect(ACCEPTED_IMAGE_FORMATS.map((f) => f.mime)).not.toContain(detectedButNotAccepted)
  })
})

describe('pixel counting', () => {
  it('multiplies the dimensions', () => {
    expect(pixelCount(4000, 3000)).toBe(12_000_000)
  })

  it('is null when a dimension is unknown, so no limit is invented', () => {
    expect(pixelCount(null, 3000)).toBeNull()
    expect(pixelCount(4000, null)).toBeNull()
    expect(pixelCount(null, null)).toBeNull()
  })

  it('keeps 50 MP above a large photo and below an absurd one', () => {
    // A 50 MP ceiling must admit an ordinary camera and refuse a fabricated image.
    expect(pixelCount(8000, 6000)).toBeLessThan(50_000_000)
    expect(pixelCount(30_000, 30_000)).toBeGreaterThan(50_000_000)
  })
})
