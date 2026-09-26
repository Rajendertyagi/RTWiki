import type { Mermaid } from 'mermaid'
import { debugLog, safeHash } from '../../../diagnostics/debug-log.js'
import { sanitizeDiagramSvg } from './svg-sanitize.js'

/**
 * RTWiki's secure Mermaid pipeline.
 *
 * Security model (ADR-007 alignment):
 * - ONE fixed configuration, defined here and never influenced by diagram
 *   content: `startOnLoad:false`, `securityLevel:'strict'` (Mermaid's
 *   DOMPurify-based label sanitization; click callbacks disabled), plus the
 *   size caps below.
 * - Determinism comes from OUR per-block render id (`mermaidRenderId`), which
 *   is derived from the block id alone, so a given block always renders with
 *   the same element ids. It does NOT come from Mermaid's `deterministicIds`
 *   flag: that flag seeds the id generator inside `mermaid.run()`, which
 *   RTWiki never calls, and `mermaidAPI.ts` does not reference it from
 *   `render()`. The flag and its seed are still set — the spelling below is
 *   the schema's own, and it would take effect if we ever moved to `run()` —
 *   but no determinism guarantee should be attributed to them.
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
 * Concurrency: Mermaid's configuration is module-global and mutable, so the
 * initialize -> parse -> render sequence is serialized. See `enqueue` below.
 *
 * Privacy: only lengths, safe hashes, durations and error codes are logged;
 * diagram source and rendered SVG are never logged.
 */

/**
 * The single authoritative Mermaid configuration for RTWiki.
 *
 * The key is `deterministicIDSeed` (capital D) — that is the spelling in
 * Mermaid's `config.schema.yaml`, in both 10.9.3 and 12.0.0. The previous
 * `deterministicIdSeed` was never read by Mermaid at all; see the note above on
 * why that had no visible effect.
 */
export const MERMAID_CONFIG = Object.freeze({
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true,
  deterministicIds: true,
  deterministicIDSeed: 'rtwiki',
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
  code: 'parse_error' | 'render_error' | 'cancelled'
}

export type MermaidRenderResult = MermaidRenderSuccess | MermaidRenderFailure

/**
 * Serializes Mermaid's mutable-config critical section.
 *
 * Mermaid holds its configuration in module-global state, and BOTH `parse` and
 * `render` call `processAndSetConfigs`, which resets and rewrites that shared
 * config; `initialize` writes it outright. Two overlapping renders can
 * therefore read a config another one just rewrote — and both block-view
 * effects pass the SAME block id, so the overlap is real rather than
 * theoretical. Verified in 10.9.3: `mermaidAPI.ts` `render()` opens with
 * `processAndSetConfigs(text)`.
 *
 * Mermaid queues `render` internally, but `parse` is NOT queued, which is why
 * the whole initialize -> parse -> render sequence has to be serialized here.
 *
 * The chain is deliberately never poisoned: `task` runs whether the previous
 * link fulfilled or rejected, and the stored tail swallows rejections, so one
 * failed diagram cannot wedge every later render.
 */
let configQueue: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = configQueue.then(task, task)
  configQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

/**
 * Applies the fixed RTWiki configuration.
 *
 * Called before EVERY render, not only when the theme changes. A cached
 * "already applied" flag looked sufficient once, but `parse` and `render` each
 * rewrite the shared config — so skipping `initialize` on the assumption that
 * our settings persist is exactly the assumption that cannot be trusted.
 * `initialize` is a deep copy of a small object; the cost of being certain is
 * negligible next to a diagram rendered under a config we did not choose.
 */
function applyConfig(
  mermaid: { initialize: (config: Record<string, unknown>) => void },
  theme: MermaidTheme
): void {
  mermaid.initialize({ ...MERMAID_CONFIG, theme })
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
 *
 * The whole initialize -> parse -> render sequence runs inside `enqueue`,
 * because Mermaid's config is shared mutable module state. Pass `signal` to
 * abandon a render that is queued or in flight but no longer wanted: without
 * it, a superseded or unmounted render would still occupy a queue slot and
 * delay the render that replaced it.
 */
export async function renderMermaidSvg(
  source: string,
  options: {
    theme: MermaidTheme
    blockId: string
    blockType: 'diagram' | 'mindMap'
    /** Aborts a queued or in-flight render whose caller no longer wants it. */
    signal?: AbortSignal
  }
): Promise<MermaidRenderResult> {
  const startedAt = Date.now()
  debugLog('editor', 'editor_block_render_requested', {
    targetId: options.blockId,
    code: options.blockType,
    len: source.length,
    hash: safeHash(source)
  })
  return enqueue(async () => {
    // A caller that has already moved on must not spend a render slot.
    if (options.signal?.aborted) {
      return { ok: false, code: 'cancelled' }
    }
    // 'import' | 'init' | 'parse' | 'render' | 'sanitize' — narrows any
    // failure to a phase without ever logging diagram content.
    let stage = 'import'
    try {
      // Lazy import keeps Mermaid out of the initial application chunk.
      // v10 ships a single eager bundle: every diagram type is registered in
      // the main module, so detection cannot be broken by chunk splitting.
      const mermaid: Mermaid = (await import('mermaid')).default
      if (!mermaid || typeof mermaid.initialize !== 'function') {
        throw new Error('mermaid module unavailable')
      }
      stage = 'init'
      applyConfig(mermaid, options.theme)
      stage = 'parse'
      await mermaid.parse(source)
      // `parse` is the unqueued step and the longest one; re-check before
      // spending an actual render on output nobody will read.
      if (options.signal?.aborted) {
        return { ok: false, code: 'cancelled' }
      }
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
      // Bounded, content-free diagnostic: error NAME + phase + source LENGTH
      // only. Mermaid parse errors can embed source snippets, so messages and
      // content are never logged.
      const name = err instanceof Error ? err.name : typeof err
      console.warn(`rtwiki mermaid render failed at ${stage}: ${name} (len=${source.length})`)
      debugLog('editor', 'editor_block_render_failed', {
        targetId: options.blockId,
        code: `${options.blockType}-${stage}`,
        result: 'error',
        durMs: Date.now() - startedAt
      })
      return { ok: false, code: stage === 'parse' ? 'parse_error' : 'render_error' }
    }
  })
}
