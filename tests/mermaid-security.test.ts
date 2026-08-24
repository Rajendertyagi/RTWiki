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
    expect(MERMAID_CONFIG.deterministicIdSeed).toBe('rtwiki')
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
