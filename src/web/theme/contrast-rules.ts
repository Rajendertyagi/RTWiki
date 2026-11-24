/**
 * Centralized contrast rule book for RTWiki.
 *
 * ONE source of truth for WCAG thresholds and token-role classification. Gates
 * (Phase 3 pure logic, Phase 4 browser computed styles, status colours) query
 * this module instead of hardcoding numbers or deciding per token what needs a
 * contrast check. No theme JSON is edited to satisfy a gate: a waiver is a
 * first-class, documented, reviewable decision that lives here.
 *
 * Pure and typed. The only import is a type from the server-safe token-name
 * module, so this file has no runtime dependency on browser-only code.
 */

import type { RequiredVariantToken } from './tokens.js'

/** WCAG 2.1 AA minimum for normal-size text (success criterion 1.4.3). */
export const TEXT_CONTRAST_MIN = 4.5

/** WCAG 2.1 AA minimum for non-text UI components and graphical objects (1.4.11). */
export const UI_CONTRAST_MIN = 3.0

/** Reduced-contrast slider floor: text must stay legible even at contrast 50. */
export const READABILITY_FLOOR = 3.0

/** Why a token is classified the way it is. Every role carries a rationale. */
export type ContrastRole = 'text' | 'ui' | 'decorative' | 'surface'

export interface ContrastRequirement {
  min: number
  rationale: string
}

const ROLE_RATIONALES: Record<ContrastRole, string> = {
  text: 'Foreground text must meet WCAG 2.1 AA 4.5:1 (1.4.3) on every surface it is drawn over.',
  ui: 'Non-text UI components must meet WCAG 2.1 AA 3:1 (1.4.11) so controls stay identifiable.',
  decorative:
    "Subtle divider by design; interactive controls are distinguished by background fill and focus rings, so WCAG 1.4.11's 3:1 requirement for identifying UI components does not apply to purely decorative separation. Measured 1.00–2.33:1 at contrast 150.",
  surface:
    'A background/surface, not a foreground. It is the thing text is measured against, so it has no foreground contrast requirement of its own.'
}

/** Explicit role for every variant token; adding a token forces a decision here. */
const TOKEN_ROLES: Record<RequiredVariantToken, ContrastRole> = {
  canvas: 'surface',
  pane: 'surface',
  rail: 'surface',
  elevated: 'surface',
  border: 'decorative',
  text: 'text',
  textMuted: 'text',
  hover: 'surface',
  selected: 'surface'
}

/** Only foreground roles carry a numeric threshold; the rest are exempt. */
const ROLE_THRESHOLDS: Record<Extract<ContrastRole, 'text' | 'ui'>, number> = {
  text: TEXT_CONTRAST_MIN,
  ui: UI_CONTRAST_MIN
}

/** The role assigned to a variant token, or null for an unknown token. */
export function contrastRoleFor(token: string): ContrastRole | null {
  return Object.hasOwn(TOKEN_ROLES, token) ? TOKEN_ROLES[token as RequiredVariantToken] : null
}

/** The documented rationale for a token's role, or null for an unknown token. */
export function rationaleFor(token: string): string | null {
  const role = contrastRoleFor(token)
  return role === null ? null : ROLE_RATIONALES[role]
}

/**
 * The contrast requirement for a token, or null when it has none.
 *
 * Surfaces are backgrounds (the thing text is measured against) and decorative
 * tokens are an explicit, documented waiver — both return null. Callers should
 * report `rationaleFor(token)` when this returns null so the waiver stays visible.
 */
export function contrastRequirementFor(token: string): ContrastRequirement | null {
  const role = contrastRoleFor(token)
  if (role === null || role === 'surface' || role === 'decorative') return null
  return { min: ROLE_THRESHOLDS[role], rationale: ROLE_RATIONALES[role] }
}
