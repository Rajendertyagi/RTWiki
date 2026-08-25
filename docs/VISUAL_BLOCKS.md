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
menu. The Insert/slash entries stay uncluttered — Diagram insertion uses a
single flowchart starter; the six common diagram shapes (flowchart, sequence,
class, state, entity-relationship, timeline) are offered as a **starter
template picker** inside the Diagram edit pane.

### Live editing (Diagram & Mind Map)

Both blocks are preview-first. The normal view shows only the rendered,
sanitized SVG with a compact toolbar (Edit, Fit/Actual, and zoom for Mind
Map). Choosing **Edit** opens a split editor:

- **Source** on the left, **live rendered preview** on the right.
- Typing re-renders the preview automatically (debounced) — you do **not**
  need to Apply merely to see a change.
- **Apply** commits the source and returns to the normal view; **Cancel**
  restores the last applied source.
- Invalid syntax shows a contained error inside the preview column while the
  source stays editable, so you can fix it in place.
- On narrow viewports the split stacks vertically (source above preview).
- **Fit width** (default) scales the SVG to the column; **Actual size** lets
  the pane scroll. Mind Map adds **zoom** controls (50%–200%, resize-based so
  the SVG is never clipped).

### Callouts

Callouts support five variants (Info, Note, Tip, Warning, Danger) with
editable rich text. The variant can be **changed after insertion** from the
callout's action menu without disturbing the rich text or any other stored
prop — only the `variant` prop changes.

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
- Duplicate, autosave and restart behave exactly as for default blocks.
- **Rich-page search** parses the canonical BlockNote JSON and indexes only
  readable text — paragraph, heading, list and callout text, table cells and
  ordinary code. Formula, Diagram and Mind Map source are intentionally **not**
  indexed (their raw Mermaid/LaTeX is not readable prose), and the
  unsupported-block preservation marker is never indexed. JSON punctuation and
  internal props never reach search results.

## Debug Mode

Render lifecycles emit allowlisted Debug Mode events
(`editor_block_render_requested/succeeded/failed`) carrying block type,
block ID, duration, source length and safe hash — never source content or
rendered output. See [Debug Mode](DEBUG_MODE.md).

## Dependencies

Exact-pinned additions (MPL-2.0): `@blocknote/math-block@0.54.0`
(pulls KaTeX), `mermaid@11.17.1`. Mermaid is lazy-loaded and never part of
the initial application chunk.
