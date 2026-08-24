import { debugLog, safeHash } from '../../../diagnostics/debug-log.js'
import { sanitizeDiagramSvg } from './svg-sanitize.js'

/**
 * RTWiki's secure Mermaid pipeline.
 *
 * Security model (ADR-007 alignment):
 * - ONE fixed configuration, defined here and never influenced by diagram
 *   content: `startOnLoad:false`, `securityLevel:'strict'` (Mermaid's
 *   DOMPurify-based label sanitization; click callbacks disabled), and
 *   deterministic IDs so the same source renders byte-stable output.
 * - Mermaid's `secure` list locks `securityLevel`, `startOnLoad`,
 *   `maxTextSize`, `maxEdges` and `suppressErrorRendering` against
 *   frontmatter/`%%{init}%%` directives inside diagram source — a diagram
 *   cannot weaken its own sandbox.
 * - Rendered SVG is additionally passed through `sanitizeDiagramSvg`
 *   (script/iframe/object/embed removal, event-handler stripping, external
 *   reference stripping) before it is ever attached to the document.
 * - Rendering failures resolve to a typed error result and stay contained
 *   to the block; they never throw into the editor.
 *
 * Privacy: only lengths, safe hashes, durations and error codes are logged;
 * diagram source and rendered SVG are never logged.
 */

/** The single authoritative Mermaid configuration for RTWiki. */
export const MERMAID_CONFIG = Object.freeze({
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true,
  deterministicIds: true,
  deterministicIdSeed: 'rtwiki',
  maxTextSize: 200_000,
  maxEdges: 500,
  fontFamily: 'inherit'
})

export type MermaidTheme = 'default' | 'dark'

export interface MermaidRenderSuccess {
  ok: true
  svg: string
}

export interface MermaidRenderFailure {
  ok: false
  /** Bounded machine-readable failure code (never raw error text). */
  code: 'parse_error' | 'render_error'
}

export type MermaidRenderResult = MermaidRenderSuccess | MermaidRenderFailure

let initializedFor: MermaidTheme | null = null

/**
 * Applies the fixed RTWiki configuration. Called before every render so the
 * active theme always matches the application colour scheme; every other
 * key is identical each time, so output stays deterministic.
 */
function applyConfig(
  mermaid: { initialize: (config: Record<string, unknown>) => void },
  theme: MermaidTheme
): void {
  mermaid.initialize({ ...MERMAID_CONFIG, theme })
  initializedFor = theme
}

/** Stable per-block render id seed: derived from the block id only. */
export function mermaidRenderId(blockId: string): string {
  return `rtwiki-mmd-${safeHash(blockId)}`
}

/**
 * Renders Mermaid source to sanitized SVG.
 *
 * Lazy-loads Mermaid on first use so the initial application chunk never
 * carries it. All failures resolve (never throw) with a bounded code.
 */
export async function renderMermaidSvg(
  source: string,
  options: { theme: MermaidTheme; blockId: string; blockType: 'diagram' | 'mindMap' }
): Promise<MermaidRenderResult> {
  const startedAt = Date.now()
  debugLog('editor', 'editor_block_render_requested', {
    targetId: options.blockId,
    code: options.blockType,
    len: source.length,
    hash: safeHash(source)
  })
  // 'import' | 'init' | 'parse' | 'render' | 'sanitize' — narrows any
  // failure to a phase without ever logging diagram content.
  let stage = 'import'
  try {
    // Lazy import keeps Mermaid (~1 MB) out of the initial application chunk.
    const mod = (await import('mermaid')) as unknown as {
      default?: typeof import('mermaid')['default']
      mermaid?: typeof import('mermaid')['default']
    }
    const mermaid = mod.default ?? mod.mermaid
    if (!mermaid || typeof mermaid.initialize !== 'function') {
      throw new Error('mermaid module unavailable')
    }
    stage = 'init'
    if (initializedFor !== options.theme) {
      applyConfig(mermaid, options.theme)
    }
    stage = 'parse'
    await mermaid.parse(source)
    stage = 'render'
    const { svg } = await mermaid.render(mermaidRenderId(options.blockId), source)
    stage = 'sanitize'
    const clean = sanitizeDiagramSvg(svg)
    if (!clean) {
      debugLog('editor', 'editor_block_render_failed', {
        targetId: options.blockId,
        code: options.blockType,
        result: 'error',
        durMs: Date.now() - startedAt
      })
      return { ok: false, code: 'render_error' }
    }
    debugLog('editor', 'editor_block_render_succeeded', {
      targetId: options.blockId,
      code: options.blockType,
      result: 'ok',
      durMs: Date.now() - startedAt
    })
    return { ok: true, svg: clean }
  } catch (err) {
    // Bounded, content-free diagnostic: error NAME + phase only. Mermaid
    // parse errors can embed source snippets, so messages are never logged.
    const name = err instanceof Error ? err.name : typeof err
    console.warn(`rtwiki mermaid render failed at ${stage}: ${name}`)
    debugLog('editor', 'editor_block_render_failed', {
      targetId: options.blockId,
      code: `${options.blockType}-${stage}`,
      result: 'error',
      durMs: Date.now() - startedAt
    })
    return { ok: false, code: stage === 'parse' ? 'parse_error' : 'render_error' }
  }
}
