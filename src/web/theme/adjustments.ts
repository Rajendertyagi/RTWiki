/**
 * Pure oklch string adjustments for the Interface sliders.
 *
 * Theme tokens are authored as `oklch(L C H / A)` strings. Adjusting lightness
 * or alpha needs no colour-space conversion — parse the numbers, change one,
 * rebuild the string. This module is shared by the server pre-paint bootstrap
 * and the browser's live slider updates so both produce identical values.
 */

import {
  CONTRAST_DEFAULT,
  CONTRAST_MAX,
  CONTRAST_MIN,
  GLASS_OPACITY_DEFAULT,
  GLASS_OPACITY_MAX,
  GLASS_OPACITY_MIN
} from '@rtwiki/shared/constants'

export interface Adjustments {
  /** 100 = no change; 50..150. */
  contrast: number
  /** 100 = fully opaque; 30..100. */
  glassOpacity: number
}

const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value))
}

/**
 * Runtime guard for slider values. TypeScript declares these as `number`, but
 * a corrupt DB row or DOM dataset can deliver null/undefined/NaN/a string at
 * runtime. Non-finite and non-number values fall back to the neutral default.
 */
function clampAdjustment(value: unknown, lo: number, hi: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, lo, hi) : fallback
}

/** Adjust the L channel of an oklch colour by a signed delta. */
export function adjustLightness(value: string, delta: number): string {
  const m = OKLCH.exec(value.trim())
  if (!m) return value
  const l = Number(clamp(Number(m[1]) + delta, 0, 1).toFixed(4))
  const alpha = m[4] === undefined ? '' : ` / ${m[4]}`
  return `oklch(${l} ${m[2]} ${m[3]}${alpha})`
}

/** Scale the alpha channel of an oklch colour by a factor. */
export function adjustAlpha(value: string, factor: number): string {
  const m = OKLCH.exec(value.trim())
  if (!m) return value
  const alpha = Number(clamp((m[4] === undefined ? 1 : Number(m[4])) * factor, 0, 1).toFixed(4))
  return `oklch(${m[1]} ${m[2]} ${m[3]} / ${alpha})`
}

/**
 * Apply the contrast slider to a variant's text/border tokens.
 * Light scheme: darker text = more contrast (direction -1).
 * Dark scheme: lighter text = more contrast (direction +1).
 */
export function applyContrast<T extends Record<string, string>>(
  variant: T,
  scheme: 'light' | 'dark',
  contrast: number
): T {
  // The live slider path calls this directly, bypassing bootstrap's clamp, so
  // clamp here too: an unclamped NaN would build `oklch(NaN ...)` CSS.
  const safeContrast = clampAdjustment(contrast, CONTRAST_MIN, CONTRAST_MAX, CONTRAST_DEFAULT)
  if (safeContrast === CONTRAST_DEFAULT) return variant
  const direction = scheme === 'light' ? -1 : 1
  const amount = (safeContrast - CONTRAST_DEFAULT) / CONTRAST_DEFAULT
  const result: Record<string, string> = { ...variant }
  for (const [name, factor] of [
    ['text', 0.15],
    ['textMuted', 0.12],
    ['border', 0.1]
  ] as const) {
    const value = result[name]
    if (value) result[name] = adjustLightness(value, direction * amount * factor)
  }
  return result as T
}

/** Apply the glass slider to a floating-surface colour. */
export function applyGlass(value: string, glassOpacity: number): string {
  // Clamp here too: the live slider path bypasses bootstrap's clamp, and an
  // unclamped NaN would build `oklch(... / NaN)` CSS.
  const safeOpacity = clampAdjustment(
    glassOpacity,
    GLASS_OPACITY_MIN,
    GLASS_OPACITY_MAX,
    GLASS_OPACITY_DEFAULT
  )
  if (safeOpacity === GLASS_OPACITY_DEFAULT) return value
  return adjustAlpha(value, safeOpacity / GLASS_OPACITY_DEFAULT)
}
