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
 *
 * The three appearance keys below exist ONLY because of Mermaid 12, and each one
 * is load-bearing. They are asserted in `tests/mermaid-security.test.ts` so a
 * tidy-up cannot drop them silently and re-lay-out or recolour every diagram in
 * the database.
 *
 * - `layout: 'dagre'` — 12 makes ELK the bundled default layout. Without this,
 *   flowchart/state/class/ER/requirement diagrams re-lay out. ELK is a separate
 *   chunk, so pinning dagre also keeps it out of what we fetch.
 * - `look: 'classic'` — 12 ships `redux-color`/`neo` as the default appearance.
 *   Without this every diagram recolours, which would also break our dark mode's
 *   agreement with the rest of the app. `look` does not exist before 12, so it
 *   could not be set during the 11.17.2 step.
 * - `mindmap: { layout: 'cose-bilkent' }` — MANDATORY, and the subtlest of the
 *   three. Until 11, the mindmap renderer hardcoded `cose-bilkent` and ignored
 *   config. From 11 it resolves through the layout registry, so the top-level
 *   `dagre` above would otherwise capture mindmaps too. Measured, not assumed:
 *   with the global default in place on 11.17.2, mindmap still resolved to
 *   `cose-bilkent` (identical rendered SVG), because 12's `layout` is derived
 *   from `class.layout`, which is unset. 12's global default is `elk`, and an
 *   explicit per-diagram value is the only way to be certain rather than
 *   dependent on that derivation.
 *
 * - `htmlLabels: false` — MANDATORY, and it is ours rather than Mermaid 12's.
 *   With HTML labels (the default) Mermaid emits every node label inside a
 *   `<foreignObject>`, and `sanitizeDiagramSvg` removes `foreignObject` outright
 *   as defence in depth. The two together meant every diagram in RTWiki rendered
 *   with no labels at all: shapes and connectors, no text. That was true of
 *   every diagram type, on every page, and nothing failed - the existing tests
 *   only asserted that an `<svg>` appeared. SVG `<text>` cannot carry script or
 *   event handlers, so switching the labels to text removes the need to strip
 *   `foreignObject` at all while making the output smaller and faster.
 *   `tests/browser/diagram-labels.pwspec.ts` guards this.
 *
 * - `fontFamily` — the one setting that has to be ABSOLUTE rather than inherited, and
 *   the reason is a real cross-surface divergence that was measured, not noticed.
 *   It was `'inherit'`, which reads as the obviously-correct "use the app's font" and
 *   is in fact the opposite: it inherits from whatever host the SVG is mounted in. On
 *   the Diagram page that host carries the application stack, but inside a Rich Note
 *   the nearest ancestor with a font is BlockNote's own `.bn-default-styles`, which
 *   hardcodes `Inter, "SF Pro Display", -apple-system, …` (BlockNote 0.54,
 *   `editor.css`). So the same diagram source rendered in `Inter…` on the Rich Note
 *   and in `system-ui…` on the Diagram page. Everything else about the two was already
 *   identical — measured: same `viewBox` (`0 0 426 414`), same node fills
 *   (`rgb(236, 236, 255)`), same label text — which is exactly why the font was easy
 *   to miss and why it has to be pinned here rather than left to the cascade.
 *   `tests/mermaid-cross-surface.test.ts` guards it.
 */
export const MERMAID_CONFIG = Object.freeze({
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true,
  deterministicIds: true,
  deterministicIDSeed: 'rtwiki',
  maxTextSize: 200_000,
  maxEdges: 500,
  /*
   * The application stack, spelled out rather than inherited. `inherit` resolved
   * against BlockNote's hardcoded `.bn-default-styles` font inside a Rich Note, so
   * the same source rendered in a different typeface depending on the surface. It
   * mirrors the `fontFamily` in `theme/registry.ts`, which is the single place the
   * application's own stack is declared; this is the same value stated once more
   * because Mermaid bakes the font into the SVG it emits and cannot be handed a
   * live token.
   */
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  layout: 'dagre',
  look: 'classic',
  htmlLabels: false,
  mindmap: { layout: 'cose-bilkent' }
})

export type MermaidTheme = 'default' | 'dark'

export interface MermaidRenderSuccess {
  ok: true
  svg: string
}

export interface MermaidRenderFailure {
  ok: false
  /** Bounded machine-readable failure code (never raw error text). */
  code: 'parse_error' | 'render_error' | 'cancelled' | 'empty_source'
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

/**
 * Pre-loads every lazily-registered Mermaid diagram definition, once.
 *
 * This is a bulk warm-up, NOT a correctness fix. Mermaid 12's ordinary
 * `parse` + `render` path already loads a diagram definition on demand the
 * first time a type is encountered — `Diagram.fromText` calls `getDiagram`,
 * and on failure falls back to `getDiagramLoader(type)` and awaits it
 * (mermaid.core.mjs, `Diagram.fromText`). Every type offered in
 * `DIAGRAM_TEMPLATES` therefore renders with or without this call; that was
 * measured, in Chromium, against both paths, with identical output.
 *
 * An earlier revision of this comment claimed the opposite — that twelve types
 * resolved to an empty 24x24 SVG without it, and that those were the types
 * deliberately absent from the template list. That claim did not reproduce, and
 * the exclusion rested on it. This comment records the correction.
 *
 * What it does buy is latency: all lazy chunks are resolved before the first
 * render instead of each being awaited mid-render, so a first diagram does not
 * pay for the chunks of the 30-odd types the user will never open.
 *
 * `registerExternalDiagrams` is public, documented API on Mermaid's `Mermaid`
 * interface. Passing an empty list adds no external diagrams; it exists purely
 * to trigger the bulk load, so `addDiagrams()` registers the detectors and the
 * force-load resolves them all at once.
 *
 * It runs once per session, inside the render mutex, because it mutates the same
 * module-global registry the render path reads.
 */
let diagramsLoaded: Promise<void> | null = null

async function ensureDiagramsLoaded(mermaid: Mermaid): Promise<void> {
  diagramsLoaded ??= mermaid.registerExternalDiagrams([], { lazyLoad: false }).then(() => undefined)
  try {
    await diagramsLoaded
  } catch (error) {
    // A failed force-load must not poison every later render, and must not fail
    // the render either: the eagerly-registered types still work without it.
    diagramsLoaded = null
    debugLog('editor', 'editor_mermaid_lazy_load_failed', {
      code: error instanceof Error ? error.name : 'unknown'
    })
  }
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
  // Empty source is a legitimate state, not malformed Mermaid.
  //
  // The live-preview paths pass `debouncedDraft` straight from the user's textarea, so a
  // cleared block legitimately arrives here as "". The stored schema allows it too
  // (`VisualPageBlockSchema.source` bounds length but does not require a minimum), which
  // is right: refusing to save an in-progress empty block would break typing.
  //
  // Invoking the parser on it produced `UnknownDiagramError` and a console warning that
  // read as a broken diagram. There is nothing to parse and nothing wrong, so this returns
  // before the import with its own code. Non-empty input is untouched: invalid Mermaid still
  // reaches the parser and still fails as `parse_error`.
  if (source.trim().length === 0) {
    return { ok: false, code: 'empty_source' }
  }

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
      // Warm the lazy diagram registry before the first parse, so a first
      // diagram does not pay to resolve chunks for types the user never opens.
      // Correctness does not depend on it: `parse`/`render` load on demand.
      await ensureDiagramsLoaded(mermaid)
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
