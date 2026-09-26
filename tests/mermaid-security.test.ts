import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { safeHash } from '../src/web/diagnostics/debug-log.js'
import {
  MERMAID_CONFIG,
  mermaidRenderId
} from '../src/web/features/rich-editor/blocks/mermaid-render.js'

describe('mermaid security configuration', () => {
  it('pins the fixed RTWiki configuration', () => {
    expect(MERMAID_CONFIG.startOnLoad).toBe(false)
    expect(MERMAID_CONFIG.securityLevel).toBe('strict')
    expect(MERMAID_CONFIG.suppressErrorRendering).toBe(true)
    expect(MERMAID_CONFIG.deterministicIds).toBe(true)
    // The schema's own spelling, capital D. This key was previously written
    // `deterministicIdSeed`, which Mermaid has never read — the misspelling sat
    // in the config AND in this assertion, so the test passed on a key that did
    // nothing. See the note on MERMAID_CONFIG.
    expect(MERMAID_CONFIG.deterministicIDSeed).toBe('rtwiki')
  })

  it('does not carry a misspelled id-seed key', () => {
    // Guards the specific regression: a lowercase-d `deterministicIdSeed` is
    // silently ignored by Mermaid, so it would pass unnoticed forever.
    expect('deterministicIdSeed' in MERMAID_CONFIG).toBe(false)
  })

  it('pins the diagram size caps to our values, not the schema defaults', () => {
    // These are deliberately raised above Mermaid's defaults (maxTextSize
    // defaults to 50_000). An upgrade that dropped them would silently quarter
    // the largest diagram RTWiki accepts, so they are asserted explicitly.
    expect(MERMAID_CONFIG.maxTextSize).toBe(200_000)
    expect(MERMAID_CONFIG.maxEdges).toBe(500)
  })

  it('holds Mermaid 12 appearance defaults in place', () => {
    // Mermaid 12 makes ELK the default layout and `redux-color`/`neo` the
    // default appearance. Each of these keys is load-bearing: drop one and every
    // stored diagram silently re-lays out or recolours. Asserted so a refactor
    // cannot remove them as "unused" — `look` in particular does nothing on
    // Mermaid 11, so it looks like dead config until 12 arrives.
    expect(MERMAID_CONFIG.layout).toBe('dagre')
    expect(MERMAID_CONFIG.look).toBe('classic')
  })

  it('renders labels as SVG text, not HTML in a foreignObject', () => {
    // `sanitizeDiagramSvg` removes every `foreignObject` as defence in depth.
    // Mermaid puts HTML labels there by default, so with HTML labels enabled
    // every diagram lost its labels while still rendering an `<svg>` — the
    // failure mode the whole suite missed. SVG `<text>` cannot carry script or
    // event handlers, so this is both the fix and the safer setting.
    expect(MERMAID_CONFIG.htmlLabels).toBe(false)
  })

  it('pins the mindmap layout, which the global dagre default would capture', () => {
    // The subtlest of the three. Since Mermaid 11 the mindmap renderer resolves
    // its layout through the registry instead of hardcoding `cose-bilkent`, so
    // the global `dagre` above would otherwise apply to mindmaps as well. This
    // is the one pin that cannot be justified by inspection alone — it was
    // verified by rendering a mindmap under each version and comparing the SVG.
    expect(MERMAID_CONFIG.mindmap).toEqual({ layout: 'cose-bilkent' })
  })

  it('imports Mermaid by package specifier, never a dist path', () => {
    // Mermaid 12's `dist/mermaid.esm.min.mjs` contains syntax Vite's
    // es-module-lexer rejects ("content contains invalid JS syntax"). Importing
    // the specifier resolves to the core build and is safe; pointing the import
    // at that file would break the build in a way that is hard to diagnose.
    const source = readFileSync(
      new URL('../src/web/features/rich-editor/blocks/mermaid-render.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain("import('mermaid')")
    expect(source).not.toMatch(/from\s+'mermaid\/dist|import\('mermaid\/dist/)
  })

  it('is frozen: neither content nor integrations can mutate it', () => {
    expect(Object.isFrozen(MERMAID_CONFIG)).toBe(true)
    expect(() => {
      ;(MERMAID_CONFIG as { securityLevel: string }).securityLevel = 'loose'
    }).toThrow()
    expect(MERMAID_CONFIG.securityLevel).toBe('strict')
  })

  it('derives stable render ids from the block id only', () => {
    const id = mermaidRenderId('0f0a7c1e-8d21-4c9a-b2e3-5f6a7b8c9d01')
    expect(id).toBe(mermaidRenderId('0f0a7c1e-8d21-4c9a-b2e3-5f6a7b8c9d01'))
    expect(id).toMatch(/^rtwiki-mmd-[0-9a-f]{8}$/)
    expect(mermaidRenderId('different-block')).not.toBe(id)
  })

  it('render ids never embed source content', () => {
    const id = mermaidRenderId('block-1')
    expect(id).not.toContain('graph')
    expect(safeHash('graph TD A-->B')).not.toContain('graph')
  })
})
