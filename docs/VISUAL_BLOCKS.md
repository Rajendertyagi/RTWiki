# Visual Knowledge Blocks

Rich Documents support four visual block types alongside BlockNote's
defaults: **Formula**, **Diagram**, **Mind Map**, and **Callouts**. All four
behave like ordinary document blocks — preview-first, editable on demand,
autosaved through the standard pipeline, and stored inside the canonical
BlockNote JSON with no schema migration ([ADR-004](adr/ADR-004-canonical-block-json-format.md)).

## Blocks

| Block | Stored type | Source lives in | Rendering |
| --- | --- | --- | --- |
| Formula | `mathBlock` (+ inline `math`) | Plain-text content (LaTeX) | Official `@blocknote/math-block` 0.54 / KaTeX |
| Diagram | `diagram` | Plain-text content (Mermaid) | RTWiki secure Mermaid pipeline |
| Mind Map | `mindMap` | Plain-text content (Mermaid mindmap syntax) | RTWiki secure Mermaid pipeline |
| Callout | `callout` | Editable inline rich text + `variant` prop | Native custom block, theme-token styling |

Insertion is available from the toolbar **Insert** menu and the `/` slash
menu. Diagram/Mind Map blocks expose an Edit action that reveals a source
textarea with Apply/Cancel; invalid input shows a contained error state with
Retry and never affects neighbouring blocks.

## Security model (Mermaid)

One fixed configuration is applied before every render
(`src/web/features/rich-editor/blocks/mermaid-render.ts`):

- `startOnLoad: false`, `securityLevel: 'strict'`,
  `suppressErrorRendering: true`
- `deterministicIds: true` with a fixed seed, plus per-block render IDs
  derived only from the block ID — output is byte-stable across renders
- `maxTextSize`/`maxEdges` bounds

Hardening layers:

1. Mermaid's `secure` list locks `securityLevel`, `startOnLoad`,
   `maxTextSize`, `maxEdges` against frontmatter/`%%{init}%%` directives in
   diagram source — a diagram cannot weaken its own sandbox.
2. Strict mode routes label HTML through DOMPurify and disables click
   callbacks.
3. Rendered SVG passes an additional RTWiki sanitizer
   (`svg-sanitize.ts`) that removes `script`/`iframe`/`object`/`embed`/
   `foreignObject` elements, all `on*` event handlers, external references
   (`href`/`src` must be fragment-only), and `<style>` blocks carrying
   external loads.
4. CSP and the sandbox boundaries from [ADR-007](adr/ADR-007-sandboxed-custom-content.md)
   remain unchanged; diagrams never gain network access.

Rendering failures resolve to bounded error codes (`parse_error`,
`render_error`) contained to the block.

## Compatibility

- Legacy Rich Notes load unchanged; unknown future block types are preserved
  as readable JSON code blocks (marker-prefixed) instead of crashing or being
  dropped.
- Dashboard card previews extract readable callout text and never show
  serialized JSON or raw diagram/formula source.
- Duplicate, autosave, restart and search behave exactly as for default
  blocks; rich-page search indexes the canonical JSON verbatim (unchanged).

## Debug Mode

Render lifecycles emit allowlisted Debug Mode events
(`editor_block_render_requested/succeeded/failed`) carrying block type,
block ID, duration, source length and safe hash — never source content or
rendered output. See [Debug Mode](DEBUG_MODE.md).

## Dependencies

Exact-pinned additions (MPL-2.0): `@blocknote/math-block@0.54.0`
(pulls KaTeX), `mermaid@11.17.1`. Mermaid is lazy-loaded and never part of
the initial application chunk.
