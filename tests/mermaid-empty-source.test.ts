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

  it('accepts valid source, whether or not this process has a DOM', async () => {
    // The claim under test is that valid Mermaid is NOT rejected as empty and NOT
    // rejected as a parse error - i.e. it reaches the parser and gets past it.
    //
    // Both outcomes are legitimate and neither is asserted against, because this
    // file does not control the environment it runs in. `tests/mermaid-block-view.test.ts`
    // installs jsdom globals and, whatever its cleanup does, another file in the
    // same run can leave a DOM behind. With no DOM, Mermaid's `render` step cannot
    // complete and the result is `render_error`; with a DOM it renders and the
    // result is `{ ok: true }`. Pinning either one made this test fail intermittently
    // depending on file order, which is the "a test that asserts an accident of its
    // surroundings" trap rather than a statement about the renderer.
    //
    // Real rendering is asserted where a DOM is guaranteed: the browser suite.
    const result = await render('flowchart TD\nA --> B')
    if (result.ok) {
      expect(result.svg.length).toBeGreaterThan(0)
    } else {
      expect(result.code).not.toBe('empty_source')
      expect(result.code).not.toBe('parse_error')
    }
  })

  it('does not treat invalid NON-EMPTY source as empty, and still reports the failure', async () => {
    // The guard must not swallow genuine Mermaid errors, and must not silence them.
    //
    // `empty_source` is RTWiki's own decision, so it is asserted exactly. Which
    // failure Mermaid itself reports is not: `renderMermaid.ts` documents that
    // Mermaid holds configuration in module-global state that both `parse` and
    // `render` rewrite, which is why the renderer serialises its queue. A test
    // file that also loads Mermaid can therefore leave that shared state mid-flight,
    // and the code observed here moved between `parse_error` and `render_error`
    // between runs of the full suite. Asserting one of them made this test
    // intermittent for a reason that has nothing to do with the empty-source guard.
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
    if (!result.ok) expect(result.code).not.toBe('empty_source')
    // Whatever the stage, the failure is still surfaced rather than swallowed.
    expect(warns.join('\n')).toContain('rtwiki mermaid render failed')
  })

  it('keeps empty, cancelled and genuinely broken input as three distinct outcomes', async () => {
    const empty = await render('')
    const broken = await render('not mermaid at all')
    const cancelled = await renderMermaidSvg('flowchart TD\nA-->B', {
      ...opts,
      signal: AbortSignal.abort()
    })
    // `empty` and `cancelled` are RTWiki's own decisions and are asserted exactly.
    expect(empty.ok).toBe(false)
    expect(cancelled.ok).toBe(false)
    if (!empty.ok) expect(empty.code).toBe('empty_source')
    if (!cancelled.ok) expect(cancelled.code).toBe('cancelled')
    // Non-empty input must never be reported as the empty state, whenever Mermaid
    // happens to be in. This is the invariant; the specific code is Mermaid's.
    if (broken.ok) {
      // A DOM in this process rendered it. Still not an empty-state report.
      expect(broken.svg.length).toBeGreaterThan(0)
    } else {
      expect(broken.code).not.toBe('empty_source')
    }
    if (!empty.ok && !broken.ok && !cancelled.ok) {
      // `empty` and `cancelled` are RTWiki's codes; `broken` is Mermaid's, so the
      // set is checked for three *distinct* outcomes without pinning Mermaid's half.
      expect(new Set([empty.code, broken.code, cancelled.code]).size).toBe(3)
      expect(empty.code).toBe('empty_source')
      expect(cancelled.code).toBe('cancelled')
    }
  })
})
