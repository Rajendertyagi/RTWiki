import { describe, expect, it } from 'bun:test'
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
