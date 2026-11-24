/**
 * WCAG contrast checking for theme tokens.
 *
 * WCAG contrast is defined on sRGB relative luminance, not on Oklch L. Theme
 * tokens are authored in oklch(), so this module converts them to sRGB before
 * computing the ratio. Alpha tokens are composited over the surface they sit
 * on, so hover/selected fills can be checked too.
 */

export interface Oklch {
  l: number
  c: number
  h: number
  alpha: number
}

export function parseOklch(value: string): Oklch | null {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(
    value.trim()
  )
  if (!m) return null
  return { l: +m[1], c: +m[2], h: +m[3], alpha: m[4] === undefined ? 1 : +m[4] }
}

/** Oklch -> linear sRGB (Björn Ottosson's Oklab matrices). */
function oklchToLinearSrgb(color: Oklch): [number, number, number] {
  const h = (color.h * Math.PI) / 180
  const a = color.c * Math.cos(h)
  const b = color.c * Math.sin(h)
  const l_ = color.l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = color.l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = color.l - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
}

/** Composite a possibly-translucent foreground over an opaque background. */
export function composite(foreground: Oklch, background: Oklch): [number, number, number] {
  const fg = oklchToLinearSrgb(foreground)
  const bg = oklchToLinearSrgb(background)
  return fg.map((channel, i) => channel * foreground.alpha + bg[i] * (1 - foreground.alpha)) as [
    number,
    number,
    number
  ]
}

function relativeLuminance(linearRgb: [number, number, number]): number {
  // WCAG relative luminance uses LINEAR sRGB values directly. Do not apply
  // the sRGB gamma transfer function here — that would inflate luminance and
  // understate contrast.
  const [r, g, b] = linearRgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two composited colours. */
export function contrastRatio(foreground: Oklch, background: Oklch): number {
  const l1 = relativeLuminance(composite(foreground, background))
  const l2 = relativeLuminance(composite(background, background))
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}
