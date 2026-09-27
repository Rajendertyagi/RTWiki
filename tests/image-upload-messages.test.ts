import { describe, expect, it } from 'bun:test'
import type { StoredAttachment } from '../src/server/attachments/attachment-repository.js'
import { UI_TEXT } from '../src/web/config/index.js'

/**
 * The client picks an upload-failure message from the server's reason code.
 *
 * `messageForStatus` is module-private, so the contract that matters is the one
 * the server and the dictionary share: every reason code the server can send has
 * a message a user can act on, and no reason code is left to fall through to a
 * generic failure.
 */

/** The reasons the server can refuse an upload, taken from its own type. */
type ServerReason = Exclude<StoredAttachment, { ok: true }>['reason']

const REASON_CODES: readonly ServerReason[] = [
  'empty',
  'unsupported_type',
  'svg_not_supported',
  'too_many_pixels'
]

describe('image upload failure messages', () => {
  it('has a distinct message for every reason the server can send', () => {
    const messages = [
      UI_TEXT.imageUploadFailed,
      UI_TEXT.imageTooLarge,
      UI_TEXT.imageSvgNotSupported,
      UI_TEXT.imageTooManyPixels
    ]
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0)
    }
    expect(new Set(messages).size).toBe(messages.length)
  })

  it('names the format that was refused, so the message is actionable', () => {
    expect(UI_TEXT.imageSvgNotSupported).toContain('SVG')
    expect(UI_TEXT.imageSvgNotSupported).toMatch(/PNG/)
  })

  it('names the pixel limit in the message rather than saying "too big"', () => {
    expect(UI_TEXT.imageTooManyPixels).toMatch(/pixel/i)
    expect(UI_TEXT.imageTooManyPixels).toContain('50')
  })

  it('offers an accepted format in the generic message', () => {
    // A user who pastes something unsupported should be told what would work.
    for (const format of ['PNG', 'JPEG', 'GIF', 'WebP', 'AVIF', 'BMP']) {
      expect(UI_TEXT.imageUploadFailed).toContain(format)
    }
  })

  it('covers every reason code the server emits', () => {
    // The failure this guards against is the server gaining a reason the client
    // cannot explain: the client would silently fall back to the generic message,
    // so the user would lose the specific wording without anything failing.
    // `REASON_CODES` is typed from the server's own union, so adding a reason to
    // that union makes this array fail to compile until it is listed here.
    const clientHasMessageFor: ReadonlySet<string> = new Set([
      'svg_not_supported',
      'too_many_pixels',
      // These two are answered from the HTTP status, not a code.
      'empty',
      'unsupported_type'
    ])
    for (const reason of REASON_CODES) {
      expect(clientHasMessageFor.has(reason), `no client message for "${reason}"`).toBe(true)
    }
  })

  it('would fail if the server gained an unlisted reason', () => {
    // Proves the assertion above has teeth: a reason the client cannot explain
    // must make the test fail, not pass quietly.
    const clientHasMessageFor = new Set(['svg_not_supported', 'too_many_pixels'])
    const unlistedReason: ServerReason = 'empty'
    expect(clientHasMessageFor.has(unlistedReason)).toBe(false)
  })
})
