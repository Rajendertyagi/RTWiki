/**
 * Central component-role mapping for RTWiki.
 *
 * Mantine resolves `variant="subtle"` / `"light"` text from the theme palette's
 * `-light-color` shade. That shade is authored per theme, so a palette whose
 * accent is neutral (vercel) can produce an unreadable foreground: vercel dark
 * resolves `var(--mantine-color-vercel-light-color)` to shade 0, oklch(0.36 0 0),
 * on the modal surface oklch(0.2 0 0) — 1.67:1.
 *
 * This module is the ONE place that says which RTWiki semantic role a control's
 * computed colours follow. `createVariantColorResolver()` reads the table below
 * and is installed once on the Mantine theme in `theme-factory.ts`, so every
 * component that uses Mantine's variant colour resolver (Button, ActionIcon,
 * Badge, Alert, NavLink, ThemeIcon, Menu items, Tooltip, …) is fixed together.
 * No per-screen CSS patch is needed and no component can silently fall back to
 * an unmapped Mantine default.
 *
 * Deliberately NOT touched here:
 *  - `--mantine-color-default`, `-disabled`, `-disabled-border` (owner decision
 *    3). The `default` variant and the disabled state are delegated unchanged
 *    to Mantine's resolver; `css-variables.ts` keeps their fallback logging.
 *  - Status colours (owner decision 1). The resolver only overrides the
 *    theme's own accent (`theme.primaryColor`); red/teal/orange/… come from
 *    Mantine's fixed palette and are returned byte-for-byte by the default
 *    resolver.
 *  - `filled` (white-on-accent) and `gradient`/`white`/`none`, which already
 *    carry their own contrast and are left to Mantine.
 */

import {
  defaultVariantColorsResolver,
  type MantineColor,
  type MantineTheme,
  type VariantColorResolverResult,
  type VariantColorsResolver
} from '@mantine/core'

import { contrastRatio, parseOklch } from './contrast.js'
import { TEXT_CONTRAST_MIN } from './contrast-rules.js'
import type { ThemeVariant } from './tokens.js'

/** CSS custom properties published by `buildThemeCssVariables`. */
export const CONTROL_TEXT_VAR = 'var(--rtwiki-text)'
export const CONTROL_MUTED_VAR = 'var(--rtwiki-text-muted)'
export const CONTROL_HOVER_VAR = 'var(--rtwiki-hover)'
export const CONTROL_SELECTED_VAR = 'var(--rtwiki-selected)'
export const CONTROL_BORDER_VAR = 'var(--rtwiki-border)'

/**
 * Mantine's `-light-color` alias target for each scheme. This is the shade the
 * broken subtle/light foreground resolves to before RTWiki's mapping, and is
 * exported so the contrast gate can report the measured before/after.
 */
export const MANTINE_LIGHT_COLOR_SHADE = { light: 9, dark: 0 } as const

/** The semantic role a computed colour follows. */
export type ColorRole =
  | 'foreground'
  | 'muted'
  | 'surface-canvas'
  | 'surface-pane'
  | 'surface-elevated'
  | 'surface-hover'
  | 'surface-selected'
  | 'border'
  | 'accent'
  | 'accent-contrast'
  | 'status-fixed'
  | 'neutral-default'
  | 'none'

/** What a variant's computed colours are sourced from. */
export type ColorSource = 'rtwiki' | 'mantine-default' | 'fixed-status' | 'neutral-default'

/**
 * One colour field and who owns the value the resolver emits for it.
 *
 * `source`/`overridden` are per-field, not per-variant: the resolver overrides
 * text, hover and (for `outline`) border, but never background. A variant-level
 * flag would claim RTWiki owns backgrounds it does not emit.
 */
export interface ColorAssignment {
  /** The semantic role the colour follows. */
  role: ColorRole
  /** Where the emitted value comes from. */
  source: ColorSource
  /** True when the resolver replaces Mantine's computed value for this field. */
  overridden: boolean
}

export interface VariantRole {
  /** Foreground text role. */
  text: ColorAssignment
  /** Background fill role. */
  background: ColorAssignment
  /** Border role (a full CSS border shorthand when applied). */
  border: ColorAssignment
  /** Hover fill role. */
  hover: ColorAssignment
}

/** A field Mantine owns — the resolver emits no override for it. */
function mantine(role: ColorRole): ColorAssignment {
  return { role, source: 'mantine-default', overridden: false }
}

/** A field RTWiki owns — the resolver emits an override for it. */
function rtwiki(role: ColorRole): ColorAssignment {
  return { role, source: 'rtwiki', overridden: true }
}

/**
 * The authoritative variant -> role table. The resolver reads this directly;
 * it is not a parallel description that can drift from behaviour.
 *
 * `light` and `subtle` keep their distinct backgrounds (accent tint vs
 * transparent) but share the readable RTWiki foreground. `outline` keeps its
 * transparent fill and gains a readable text/border. `default`, `filled`,
 * `white`, `gradient` and `none` are intentionally left to Mantine.
 *
 * Deliberate tradeoff: for the accent `light`/`subtle`/`outline`/`transparent`
 * variants the resolver renders neutral `--rtwiki-text` instead of an
 * accent-tinted foreground. This reduces accent affordance, but the accent
 * palette's `-light-color` shade is not guaranteed readable on every theme
 * surface (vercel dark measured 1.67:1). The contrast rule book
 * (`contrast-rules.ts`, 4.5:1 text) is the reason: readability wins over tint.
 * Backgrounds stay Mantine-owned, so the accent tint still carries the variant
 * identity where Mantine supplies one (`light`).
 */
export const VARIANT_ROLES = {
  filled: {
    text: mantine('accent-contrast'),
    background: mantine('accent'),
    border: mantine('none'),
    hover: mantine('accent')
  },
  light: {
    text: rtwiki('foreground'),
    background: mantine('accent'),
    border: mantine('none'),
    hover: rtwiki('surface-hover')
  },
  subtle: {
    text: rtwiki('foreground'),
    background: mantine('none'),
    border: mantine('none'),
    hover: rtwiki('surface-hover')
  },
  transparent: {
    text: rtwiki('foreground'),
    background: mantine('none'),
    border: mantine('none'),
    hover: rtwiki('none')
  },
  outline: {
    text: rtwiki('foreground'),
    background: mantine('none'),
    border: rtwiki('foreground'),
    hover: rtwiki('surface-hover')
  },
  default: {
    text: { role: 'neutral-default', source: 'neutral-default', overridden: false },
    background: { role: 'neutral-default', source: 'neutral-default', overridden: false },
    border: { role: 'neutral-default', source: 'neutral-default', overridden: false },
    hover: { role: 'neutral-default', source: 'neutral-default', overridden: false }
  },
  white: {
    text: mantine('accent'),
    background: mantine('surface-elevated'),
    border: mantine('none'),
    hover: mantine('surface-elevated')
  },
  gradient: {
    text: mantine('accent-contrast'),
    background: mantine('accent'),
    border: mantine('none'),
    hover: mantine('accent')
  },
  none: {
    text: mantine('foreground'),
    background: mantine('none'),
    border: mantine('none'),
    hover: mantine('none')
  }
} as const satisfies Record<string, VariantRole>

export type VariantName = keyof typeof VARIANT_ROLES

/**
 * Interaction states that are not Mantine variants. They are expressed here so
 * the rule "disabled/default must not be flattened into primary" is a checked
 * data invariant rather than a comment. Mantine drives these through its own
 * surface variables, which `css-variables.ts` already maps (or deliberately
 * leaves at the default, with logging, for the three risky keys).
 */
export const INTERACTION_ROLES = {
  default: {
    text: { role: 'neutral-default', source: 'neutral-default', overridden: false },
    background: { role: 'neutral-default', source: 'neutral-default', overridden: false },
    border: { role: 'neutral-default', source: 'neutral-default', overridden: false },
    hover: { role: 'neutral-default', source: 'neutral-default', overridden: false }
  },
  disabled: {
    text: { role: 'muted', source: 'neutral-default', overridden: false },
    background: { role: 'neutral-default', source: 'neutral-default', overridden: false },
    border: { role: 'neutral-default', source: 'neutral-default', overridden: false },
    hover: { role: 'neutral-default', source: 'neutral-default', overridden: false }
  },
  hover: {
    text: { role: 'foreground', source: 'rtwiki', overridden: false },
    background: { role: 'surface-hover', source: 'rtwiki', overridden: false },
    border: { role: 'none', source: 'mantine-default', overridden: false },
    hover: { role: 'surface-hover', source: 'rtwiki', overridden: false }
  },
  focus: {
    text: { role: 'foreground', source: 'mantine-default', overridden: false },
    background: { role: 'none', source: 'mantine-default', overridden: false },
    border: { role: 'accent', source: 'mantine-default', overridden: false },
    hover: { role: 'none', source: 'mantine-default', overridden: false }
  },
  selected: {
    text: { role: 'foreground', source: 'rtwiki', overridden: false },
    background: { role: 'surface-selected', source: 'rtwiki', overridden: false },
    border: { role: 'none', source: 'mantine-default', overridden: false },
    hover: { role: 'surface-hover', source: 'rtwiki', overridden: false }
  }
} as const satisfies Record<string, VariantRole>

export type InteractionName = keyof typeof INTERACTION_ROLES

/**
 * Every Mantine component family used in `src/web`, with the variants it
 * actually resolves. Families with an empty list are surfaces or structural
 * controls: they inherit the already-mapped Mantine surface variables and have
 * no variant colour of their own. Together with `VARIANT_ROLES` this is the
 * complete family/variant -> role mapping for the application.
 */
export const COMPONENT_ROLES = {
  // Variant-colour consumers (all go through theme.variantColorResolver).
  Button: ['filled', 'light', 'subtle', 'outline', 'default'],
  ActionIcon: ['filled', 'light', 'subtle', 'outline', 'default'],
  Badge: ['light', 'subtle', 'filled', 'outline'],
  Alert: ['light', 'filled', 'outline'],
  NavLink: ['light', 'subtle', 'filled'],
  Menu: ['subtle'],
  MenuItem: ['subtle'],
  Tooltip: ['filled'],
  ThemeIcon: ['light', 'filled', 'outline'],
  Radio: ['filled'],
  // Surfaces — no variant colour; they use --mantine-color-body/-default/-border.
  Paper: [],
  Card: [],
  Table: [],
  Modal: [],
  Popover: [],
  ScrollArea: [],
  AppShell: [],
  Container: [],
  // Inputs and toggles — --mantine-color-text/-placeholder/-default-border.
  // Input is the base TextInput renders; its default-variant border is mapped
  // centrally in theme-factory.ts via --input-bd -> --rtwiki-border.
  Input: [],
  TextInput: [],
  Textarea: [],
  Select: [],
  Combobox: [],
  Switch: [],
  Checkbox: [],
  SegmentedControl: [],
  Slider: [],
  // Structural controls — no colour role of their own.
  Box: [],
  Burger: [],
  Divider: [],
  Group: [],
  SimpleGrid: [],
  Kbd: [],
  Loader: [],
  Skeleton: [],
  Stack: [],
  Text: [],
  Title: [],
  UnstyledButton: [],
  // The provider owns the resolver installed by theme-factory.ts; it has no
  // colour role of its own but is listed so the source-usage gate is complete.
  MantineProvider: []
} as const satisfies Record<string, readonly VariantName[]>

export type ComponentFamily = keyof typeof COMPONENT_ROLES

/** Status colours are never the theme accent, so the guard below excludes them. */
export const FIXED_STATUS_COLORS = ['red', 'teal', 'orange', 'green', 'yellow', 'amber'] as const

/** Maps a semantic role to the CSS variable the resolver emits. */
export function cssVarForRole(role: ColorRole): string {
  switch (role) {
    case 'foreground':
      return CONTROL_TEXT_VAR
    case 'muted':
      return CONTROL_MUTED_VAR
    case 'surface-hover':
      return CONTROL_HOVER_VAR
    case 'surface-selected':
      return CONTROL_SELECTED_VAR
    case 'border':
      return CONTROL_BORDER_VAR
    default:
      return 'transparent'
  }
}

/**
 * True only for the active theme's own accent palette. Status colours and any
 * explicit non-accent colour keep Mantine's fixed palette (owner decision 1).
 * A shade-qualified accent such as `vercel.5` is still the accent.
 */
export function isRtwikiAccent(color: MantineColor | undefined, theme: MantineTheme): boolean {
  if (typeof color !== 'string') return false
  return color === theme.primaryColor || color.startsWith(`${theme.primaryColor}.`)
}

/**
 * Builds the theme-level variant colour resolver. Wrapping Mantine's official
 * `defaultVariantColorsResolver` means every variant we do not map keeps its
 * exact upstream behaviour, including the `default` variant's three risky
 * surface variables and the disabled state's CSS.
 */
export function createVariantColorResolver(): VariantColorsResolver {
  return (input) => {
    const resolved = defaultVariantColorsResolver(input)
    if (!isRtwikiAccent(input.color, input.theme)) return resolved

    const role = VARIANT_ROLES[input.variant as VariantName]
    if (
      role === undefined ||
      (!role.text.overridden && !role.hover.overridden && !role.border.overridden)
    ) {
      return resolved
    }

    const next: VariantColorResolverResult = {
      ...resolved,
      color: cssVarForRole(role.text.role),
      hover: role.hover.role === 'none' ? 'transparent' : cssVarForRole(role.hover.role)
    }
    if (role.border.overridden) {
      // Mantine stores the full border shorthand in --*-bd.
      next.border = `1px solid ${cssVarForRole(role.text.role)}`
    }
    return next
  }
}

/**
 * Resolves the emitted control-text variable against a concrete theme variant.
 * The resolver emits `var(--rtwiki-text)`, which `buildThemeCssVariables`
 * publishes as the variant's `text` token.
 */
export function deriveControlTextColor(variant: ThemeVariant): string {
  return variant.text
}

/**
 * Pure contrast gate for the derived control text colour. Uses the central rule
 * book threshold rather than a local 4.5 literal, and returns the measured ratio
 * so callers can report it. Throws when a token is unparsable or below the floor.
 */
export function measureControlTextContrast(
  variant: ThemeVariant,
  surface: 'canvas' | 'pane' | 'elevated'
): number {
  const foreground = parseOklch(deriveControlTextColor(variant))
  const background = parseOklch(variant[surface])
  if (foreground === null || background === null) {
    throw new Error(`control text and ${surface} tokens must be oklch() colours`)
  }
  const ratio = contrastRatio(foreground, background)
  if (ratio < TEXT_CONTRAST_MIN) {
    throw new Error(
      `control text on ${surface} is ${ratio.toFixed(2)}:1, below ${TEXT_CONTRAST_MIN}:1`
    )
  }
  return ratio
}
