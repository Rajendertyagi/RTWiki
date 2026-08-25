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

Insertion controls live directly on the persistent Rich Note toolbar — one
compact icon per entry (Formula, Diagram, Mind Map, the five Callouts,
Table, Quote, Code Block), grouped with separators and always visible; the
row scrolls horizontally on narrow screens. The `/` slash menu remains
available as an alternative surface. Diagram insertion uses a single
flowchart starter; the six common diagram shapes (flowchart, sequence,
class, state, entity-relationship, timeline) are offered as a **starter
template picker** inside the Diagram edit pane.

### Rearrangement

Every block — including all custom visual blocks — can be rearranged two
ways: the native drag handle (hover a block, drag the gutter handle) and
keyboard-accessible **Move up / Move down** actions in the drag-handle menu.
Moves preserve block ids and content, trigger autosave, return focus to the
moved block, and never cross the document boundaries (the first block has no
Move up; the last has no Move down).

### Resizing (Diagram & Mind Map)

Embedded Diagram and Mind Map blocks expose a corner resize handle (pointer)
plus always-rendered size-preset buttons — Small, Medium, Large, Full width,
Auto height — for keyboard users. Dimensions persist as typed block props
(pixel strings), are clamped to min/max bounds and the document column, and
re-clamp responsively on narrow screens without altering the stored desktop
size. Zoom/Fit of the rendered SVG is independent of the container box.

Floating menus (drag-handle menu, callout variant menu, template pickers,
toolbar popovers) render through portals above the application shell using
the shared overlay z-index token with collision-aware flip/shift placement,
so they can never paint behind the sidebar or clip against scroll
containers.

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

## Dedicated Diagram and Mind Map pages

Beyond embedded blocks, **Diagram** and **Mind Map** are real page types.
They are created from the New Page dialog, the empty-tree context menu, or
any page-row New Child menu; they appear immediately in the tree with
distinct icons/type labels, open in a tab, and support rename, duplicate,
move and delete. The database stores the type as unconstrained text — no
migration was required, and existing notes are untouched.

Each opens a dedicated full-page workspace reusing the same secure Mermaid
pipeline: a rendered view (Edit, Refresh, Fit/Actual, Zoom, full-screen) and
a split edit mode (source + live debounced preview, template picker on
Diagram pages, Apply/Cancel, contained syntax errors, shared autosave and
save status). Stored content is opaque visual-page JSON; search indexes only
the title, and dashboard cards show the readable type label — never Mermaid
source or SVG.

## Source-file IDE (HTML pages)

Clicking an HTML page's HTML/CSS/JavaScript subfile opens a lightweight IDE
around the existing CodeMirror 6 editor: a file breadcrumb, a source toolbar
(undo, redo, find, replace, Format Document, word wrap, fold/unfold all,
font size controls, full-screen editor, save now, return to preview), and a
status row (language, line/column, selection count, format errors, save
state). Shortcuts: `Ctrl+F` find, `Ctrl+H` replace, `Ctrl+S` flush save,
`Shift+Alt+F` format, `F11` full-screen toggle. Formatting uses the
exact-pinned Prettier standalone build, lazy-loaded per language only when
first invoked; results participate in undo history and trigger autosave,
failures stay contained, and empty output never replaces source. The
generation-guarded draft contract is preserved across file switches,
formatting and browser refresh.

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
