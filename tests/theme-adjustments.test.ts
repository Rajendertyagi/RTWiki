import { describe, expect, it } from 'bun:test'

import {
  adjustAlpha,
  adjustLightness,
  applyContrast,
  applyGlass
} from '../src/web/theme/adjustments.js'

describe('oklch adjustments', () => {
  it('adjusts lightness without changing chroma or hue', () => {
    expect(adjustLightness('oklch(0.5 0.02 255)', -0.1)).toBe('oklch(0.4 0.02 255)')
    expect(adjustLightness('oklch(0.5 0.02 255 / 0.5)', 0.1)).toBe('oklch(0.6 0.02 255 / 0.5)')
  })

  it('clamps lightness to 0..1', () => {
    expect(adjustLightness('oklch(0.95 0 0)', 0.5)).toBe('oklch(1 0 0)')
    expect(adjustLightness('oklch(0.05 0 0)', -0.5)).toBe('oklch(0 0 0)')
  })

  it('scales alpha', () => {
    expect(adjustAlpha('oklch(0.5 0 0)', 0.6)).toBe('oklch(0.5 0 0 / 0.6)')
    expect(adjustAlpha('oklch(0.5 0 0 / 0.5)', 0.5)).toBe('oklch(0.5 0 0 / 0.25)')
  })

  it('leaves values unchanged at the neutral point', () => {
    const variant = {
      text: 'oklch(0.4 0 0)',
      textMuted: 'oklch(0.6 0 0)',
      border: 'oklch(0.8 0 0)'
    }
    expect(applyContrast(variant, 'light', 100)).toEqual(variant)
    expect(applyGlass('oklch(0.9 0 0)', 100)).toBe('oklch(0.9 0 0)')
  })

  it('moves text darker in light and lighter in dark as contrast rises', () => {
    const variant = {
      text: 'oklch(0.4 0 0)',
      textMuted: 'oklch(0.6 0 0)',
      border: 'oklch(0.8 0 0)'
    }
    const light = applyContrast(variant, 'light', 150)
    const dark = applyContrast(variant, 'dark', 150)
    expect(light.text).toBe('oklch(0.325 0 0)')
    expect(dark.text).toBe('oklch(0.475 0 0)')
  })
})
