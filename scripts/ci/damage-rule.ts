/**
 * Pure pass/fail rule for the damaged-file phase of the fuzz runner.
 *
 * Kept separate from `random-document-runner.ts` so the rule can be unit-tested
 * without launching the built app. The runner owns the I/O (upload, read-back
 * text); this module owns only the decision.
 */

export type Damage = 'truncate' | 'flip' | 'wrongext' | 'plainzip'

/**
 * Formats whose "damage" is still ordinary text. RTF is a text format — control
 * words plus plain text — so a truncation or a few flipped bytes leaves a valid
 * (if garbled) document. There is no integrity checksum in RTF for any library
 * to check, so the strict container rule cannot apply to it.
 */
export const TEXT_DAMAGE_FORMATS: ReadonlySet<string> = new Set([
  'txt',
  'html',
  'csv',
  'md',
  'tex',
  'rtf'
])

export function isTextDamageFormat(ext: string): boolean {
  return TEXT_DAMAGE_FORMATS.has(ext)
}

/** A refusal is only meaningful if it names an actionable cause. */
const MEANINGFUL_REFUSAL = /could not be opened|not supported|password|save as|too large/i
const PLAINZIP_REFUSAL = /could not be opened|not supported|too large/i

export interface DamageResponse {
  /** 0 means the upload timed out. */
  readonly status: number
  /** First part of the response body, for the reason text. */
  readonly body: string
  readonly damage: Damage
  /** The format being tested (not the upload extension, which wrongext overrides). */
  readonly formatExt: string
  /** Text read back from the stored attachment, if the app accepted it. */
  readonly extractedText: string
  /** MIME type the app stored the bytes under, if accepted. */
  readonly storedMimeType: string | null
  /** MIME type the bytes should be stored under for a wrongext case. */
  readonly expectedMime: string
}

export interface DamageVerdict {
  readonly pass: boolean
  readonly reason: string
}

/**
 * Decides whether a damaged upload behaved acceptably.
 *
 * The strict "must refuse" rule applies only where the library itself has a
 * corruption signal it can act on: a plain zip that is not a document, or a
 * container the parser actually threw on (a 4xx with a meaningful message).
 *
 * For a container the library accepts without throwing, a 201 with extracted
 * text is a pass. The original bytes are preserved (ADR-023), the app surfaces
 * any library warning such as `CONTENT_PART_NOT_READ`, and a few flipped bytes
 * in content are indistinguishable from legitimate text — no parser can refuse
 * them without false positives on real multilingual documents.
 */
export function evaluateDamage(r: DamageResponse): DamageVerdict {
  const msg = r.body.slice(0, 200)
  if (r.status === 0) return { pass: false, reason: 'hang' }

  // Universal rules — they apply to text formats AND containers alike. A text
  // format is not exempt from them: a plain zip is never a document whatever
  // extension it arrived with, a refusal must name an actionable cause, and a
  // wrong-extension upload must be stored under the type its bytes reveal.
  if (r.damage === 'plainzip') {
    return {
      pass: r.status >= 400 && PLAINZIP_REFUSAL.test(msg),
      reason: `status ${r.status}: ${msg}`
    }
  }

  if (r.status >= 400) {
    return { pass: MEANINGFUL_REFUSAL.test(msg), reason: `refused: ${msg}` }
  }

  if (r.status !== 201) {
    return { pass: false, reason: `status ${r.status}: ${msg}` }
  }

  // Accepted (201). The wrong-extension rule is universal too: the bytes must
  // be stored under their real type, not the claimed one.
  if (r.damage === 'wrongext') {
    return {
      pass: r.storedMimeType === r.expectedMime,
      reason: `accepted as ${r.storedMimeType} (expected ${r.expectedMime}), text=${r.extractedText.slice(0, 80)}`
    }
  }

  // Truncate / flip. A text format is still text after damage; a container the
  // library accepted without throwing is equally acceptable. In both cases the
  // original bytes are preserved and any library warning is surfaced. Only the
  // reason text differs — the pass condition is the same.
  const reason = isTextDamageFormat(r.formatExt)
    ? `accepted, text=${r.extractedText.slice(0, 80)}`
    : `accepted by library, text=${r.extractedText.slice(0, 80)}`
  return { pass: r.extractedText.length > 0, reason }
}
