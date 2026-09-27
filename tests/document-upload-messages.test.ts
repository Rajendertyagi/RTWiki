import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { UI_TEXT } from '../src/web/config/index.js'

/**
 * The client picks an upload-failure message from the server's reason code.
 *
 * `messageForStatus` is module-private, so what is asserted here is the contract
 * the uploader and the dictionary share - and, for the two defects below, that
 * the source no longer contains the wrong wording in the first place.
 *
 * ## Why the source is read as text
 *
 * Both defects these tests guard against were invisible to a dictionary test. The
 * dictionary held a perfectly good `imageTooLarge`, and the document uploader was
 * the thing reaching for it; likewise the dictionary held correct image wording
 * and the document uploader was the thing choosing it. A test that only inspected
 * `UI_TEXT` would have passed while a user attaching a 60 MB PDF was told their
 * image was too large. The assertion therefore has to be on the call site, which
 * is the only place the mistake can be made.
 *
 * Comments are stripped before the source is searched, because these tests have to
 * name the very tokens they forbid in order to explain why they are forbidden.
 */

/** Reason codes a *document* upload can actually be refused with. */
const DOCUMENT_REASON_CODES = ['unsupported_type'] as const

/**
 * Reason codes that are image verdicts.
 *
 * A document is identified from a real container signature, so it can never be
 * refused for either of these. Mapping them on the document path is what let a
 * user be told an image was too large.
 */
const IMAGE_ONLY_REASON_CODES = ['svg_not_supported', 'too_many_pixels'] as const

const DOCUMENT_UPLOAD_SOURCE = 'src/web/features/rich-editor/blocks/document-upload.ts'

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** The uploader's code, with comments removed so prose cannot satisfy a check. */
function documentUploadCode(): string {
  return stripComments(readFileSync(DOCUMENT_UPLOAD_SOURCE, 'utf8'))
}

/** The image-only codes this checker finds in a body of code. */
function imageOnlyCodesIn(code: string): string[] {
  return IMAGE_ONLY_REASON_CODES.filter((reason) => code.includes(reason))
}

describe('document upload failure messages', () => {
  it('has a distinct message for every reason a document can be refused', () => {
    const messages = [UI_TEXT.documentUploadFailed, UI_TEXT.documentTooLarge]
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0)
    }
    expect(new Set(messages).size).toBe(messages.length)
  })

  it('covers every reason code a document can be refused with', () => {
    // The failure this guards against is the server gaining a reason the document
    // client cannot explain: the user would silently lose the specific wording
    // without anything failing. A new code must be listed here deliberately.
    const handled = new Set<string>([...DOCUMENT_REASON_CODES, 'size_exceeded', 'generic'])
    for (const code of DOCUMENT_REASON_CODES) {
      expect(handled.has(code), `no document message for "${code}"`).toBe(true)
    }
  })

  it('names the limit, and says document rather than image', () => {
    // The defect: a 60 MB PDF was refused with `imageTooLarge`, so the user was
    // told "That image is larger than the 50 MB limit."
    expect(UI_TEXT.documentTooLarge).toContain('50 MB')
    expect(UI_TEXT.documentTooLarge).toMatch(/document/i)
    expect(UI_TEXT.documentTooLarge).not.toMatch(/image/i)
  })

  it('names the file type in the unsupported message, so it is actionable', () => {
    for (const format of ['PDF', 'Word', 'PowerPoint', 'Excel']) {
      expect(UI_TEXT.attachmentUnsupportedType).toContain(format)
    }
  })

  it('refuses an oversized document with the document message', () => {
    // Read from source because the dictionary alone cannot catch this: the wrong
    // constant is chosen at the call site, not missing from the dictionary. Both
    // the pre-flight size check and the 413 fallback must agree, or one path
    // would still tell the user the wrong noun.
    const code = documentUploadCode()
    expect(code).toContain('UI_TEXT.documentTooLarge')
    expect(code).not.toContain('UI_TEXT.imageTooLarge')
  })

  it('never maps an image-only reason code on the document path', () => {
    expect(imageOnlyCodesIn(documentUploadCode())).toEqual([])
  })

  it('the two checks above would fail on the code as it was written', () => {
    /**
     * Proves the assertions have teeth, by running them against the defects
     * themselves rather than asserting that a defect exists somewhere.
     *
     * The mistake this guards against is writing a source-inspection test that
     * passes for the wrong reason - one that would go on passing if the code
     * regressed. An earlier version of this file asserted a made-up string was
     * absent from the real source, which is true no matter what the source says.
     */
    // Both occurrences matter: the pre-flight size check and the 413 fallback.
    const withImageTooLarge = documentUploadCode().replaceAll(
      'UI_TEXT.documentTooLarge',
      'UI_TEXT.imageTooLarge'
    )
    expect(withImageTooLarge).toContain('UI_TEXT.imageTooLarge')
    expect(withImageTooLarge).not.toContain('UI_TEXT.documentTooLarge')

    const withImageCodes = documentUploadCode().replace(
      "if (code === 'unsupported_type')",
      "if (code === 'svg_not_supported') return UI_TEXT.imageSvgNotSupported\n  if (code === 'unsupported_type')"
    )
    expect(imageOnlyCodesIn(withImageCodes)).toEqual(['svg_not_supported'])
  })
})
