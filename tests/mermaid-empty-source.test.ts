import { describe, expect, it } from 'bun:test'
import {
  type MermaidRenderResult,
  renderMermaidSvg
} from '../src/web/features/rich-editor/blocks/mermaid-render.js'

/**
 * Empty Mermaid source must never reach the parser.
 *
 * ## The bug these lock down
 *
 * The live-preview paths pass `debouncedDraft` straight from the user's textarea, so a
 * cleared diagram block legitimately arrives at the renderer as `""`. The stored schema
 * permits it too (`VisualPageBlockSchema.source` bounds length but has no minimum), which
 * is correct: refusing to save an in-progress empty block would break typing.
 *
 * The renderer nevertheless invoked Mermaid's parser on it, raising `UnknownDiagramError`
 * and logging `rtwiki mermaid render failed at parse: ... (len=0)` - a warning that read as
 * though a real diagram were broken.
 *
 * Every test here fails if the fix is reverted.
 */
describe('empty Mermaid source is not a parse failure', () => {
  const opts = { theme: 'default' as const, blockId: 'b1', blockType: 'diagram' as const }

  async function render(source: string) {
    return renderMermaidSvg(source, opts)
  }

  it('reports the empty state without invoking the parser', async () => {
    const warns: string[] = []
    const original = console.warn
    console.warn = (...a: unknown[]) => {
      warns.push(String(a[0]))
    }
    let result: MermaidRenderResult
    try {
      result = await render('')
    } finally {
      console.warn = original
    }
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('empty_source')
    // The observable defect: no "render failed" line for an empty block.
    expect(warns.join('\n')).not.toContain('rtwiki mermaid render failed')
  })

  it('treats whitespace-only source as the same empty state', async () => {
    const result = await render('   \n\t  ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('empty_source')
  })

  it('sends valid source past the parse stage, to the DOM-dependent render stage', async () => {
    // This environment has no DOM, so Mermaid's `render` step cannot complete and the
    // result is `render_error`. What matters here is that valid source is NOT rejected as
    // empty and NOT rejected as a parse error - i.e. it still reaches the parser and gets
    // past it. Real rendering is covered by the browser suite.
    const result = await render('flowchart TD\nA --> B')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).not.toBe('empty_source')
      expect(result.code).not.toBe('parse_error')
      expect(result.code).toBe('render_error')
    }
  })

  it('still fails as a parse error for invalid but NON-EMPTY source', async () => {
    // The guard must not swallow genuine Mermaid errors, and must not silence them.
    const warns: string[] = []
    const original = console.warn
    console.warn = (...a: unknown[]) => {
      warns.push(String(a[0]))
    }
    let result: MermaidRenderResult
    try {
      result = await render('this is not valid mermaid')
    } finally {
      console.warn = original
    }
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('parse_error')
    expect(warns.join('\n')).toContain('rtwiki mermaid render failed at parse')
  })

  it('keeps empty, cancelled and genuinely broken input as three distinct outcomes', async () => {
    const empty = await render('')
    const broken = await render('not mermaid at all')
    const cancelled = await renderMermaidSvg('flowchart TD\nA-->B', {
      ...opts,
      signal: AbortSignal.abort()
    })
    expect(empty.ok).toBe(false)
    expect(broken.ok).toBe(false)
    expect(cancelled.ok).toBe(false)
    if (!empty.ok && !broken.ok && !cancelled.ok) {
      expect(new Set([empty.code, broken.code, cancelled.code]).size).toBe(3)
      expect(empty.code).toBe('empty_source')
      expect(broken.code).toBe('parse_error')
      expect(cancelled.code).toBe('cancelled')
    }
  })
})
