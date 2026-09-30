# Visual Knowledge Blocks

Rich Documents support four visual block types alongside BlockNote's
defaults: **Formula**, **Diagram**, and **Callouts**, plus a **Diagram** block
that renders any Mermaid type. All behave like ordinary document blocks —
preview-first, editable on demand, autosaved through the standard pipeline, and
stored inside the canonical BlockNote JSON with no schema migration
([ADR-004](adr/ADR-004-canonical-block-json-format.md)).

A mind map is not a block of its own. Mermaid's `mindmap` is one of the diagram
types, so it is drawn by choosing that template — the same block, a different
source. See [ADR-019](adr/ADR-019-one-mermaid-page-and-block.md) for why the
separate Mind Map block and page type were retired.

## Blocks

| Block | Stored type | Source lives in | Rendering |
| --- | --- | --- | --- |
| Formula | `mathBlock` (+ inline `math`) | Plain-text content (LaTeX) | Official `@blocknote/math-block` 0.54 / KaTeX |
| Diagram | `diagram` | Plain-text content (Mermaid) | RTWiki secure Mermaid pipeline |
| Diagram (legacy read alias) | `mindMap` | Plain-text content (Mermaid mindmap syntax) | Same pipeline, plus zoom controls |
| Callout | `callout` | Editable inline rich text + `variant` prop | Native custom block, theme-token styling |

The `mindMap` row is a **read alias, not an insertion**: both names are built by
one factory in `blocks/diagram.tsx`, nothing offers `mindMap`, and it exists so a
document written before the retirement still loads as a live diagram. Only
documents that already contain the block are affected by the zoom controls it
carries.

Insertion controls live directly on the persistent Rich Note toolbar — one
compact icon per entry (Formula, Diagram, the five Callouts, Table, Quote,
Code Block), grouped with separators and always visible. The Diagram control
opens a **template chooser** listing every Mermaid type the app offers, grouped
into six colour-coded families with a divider at each change, and picking one
inserts a `diagram` block already filled with that template's source. The list is
read through the same accessor the Diagram page's template bar uses
(`diagramTemplateOptions`), so a rich note and a Diagram page can never offer
different diagrams.

**Mermaid is deliberately not in the `/` slash menu.** A slash menu lists block
types; a library of Mermaid templates is not a list of block types. Each insert
entry declares which surfaces offer it, and the slash menu keeps the entries that
include `slash`.

### Rearrangement

Every block — including all custom visual blocks — can be rearranged two
ways: the native drag handle (hover a block, drag the gutter handle) and
keyboard-accessible **Move up / Move down** actions in the drag-handle menu.
Moves preserve block ids and content, trigger autosave, return focus to the
moved block, and never cross the document boundaries (the first block has no
Move up; the last has no Move down).

### Resizing (Diagram)

Embedded Diagram blocks expose a corner resize handle (pointer)
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

### Live editing (Diagram)

Both blocks are preview-first. The normal view shows only the rendered,
sanitized SVG with a compact toolbar (Edit, Fit/Actual, and zoom on a legacy
`mindMap` block). Choosing **Edit** opens a split editor:

- **Source** on the left, **live rendered preview** on the right.
- Typing re-renders the preview automatically (debounced) — you do **not**
  need to Apply merely to see a change.
- **Apply** commits the source and returns to the normal view; **Cancel**
  restores the last applied source.
- Invalid syntax shows a contained error inside the preview column while the
  source stays editable, so you can fix it in place.
- On narrow viewports the split stacks vertically (source above preview).
- **Fit width** (default) scales the SVG to the column; **Actual size** lets
  the pane scroll. A legacy `mindMap` block adds **zoom** controls (50%–200%,
  resize-based so the SVG is never clipped); a `diagram` block does not.

### Diagram view controls

Every rendered diagram — on the Diagram page and inside a Rich Note — carries
its own view controls in the bottom-right corner, revealed on hover so they
never sit on a diagram being read:

- **Pan** in four directions, one step per press.
- **Zoom in / out**, bounded so a diagram cannot be zoomed into nothing.
- **Reset view**, returning pan and zoom to their defaults.
- **Full screen**, opening the diagram on its own; `Escape` closes it and the
  reader returns to the zoom and pan they had set.

These are **not** the block's size. The size is the corner drag handle and the
size presets; the view controls move and scale the picture inside the box. The
two do not affect each other, and **nothing here is written to the document** —
zooming in to read a wide diagram and reloading returns it to normal size.

One component (`blocks/diagram-view.tsx`) and one stylesheet serve both
surfaces. They previously had separate implementations and had drifted far
enough apart that the same diagram looked like two different things; sharing
them is the point, not an optimisation.

Covered by `tests/browser/diagram-view-controls.pwspec.ts`, which asserts on
both surfaces.

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

## Dedicated Diagram page

Beyond embedded blocks, **Diagram** is a real page type. It is created from the
New Page dialog, the empty-tree context menu, or any page-row New Child menu; it
appears immediately in the tree with a distinct icon/type label, opens in a tab,
and supports rename, duplicate, move and delete.

The Mind Map page is **retired**: it was identical to this one but for a single
ternary and two starter strings, and a mind map is now a diagram template rather
than a page type. See [ADR-019](adr/ADR-019-one-mermaid-page-and-block.md).
Migration `010_mindmap_pages_to_diagram` rewrites any surviving row to `diagram`;
it rewrites the column, not the page's content, and the content's own stored type
marker is normalised on read.

Each opens a dedicated full-page workspace reusing the same secure Mermaid
pipeline: a rendered view (Edit, Refresh, Fit/Actual, Zoom, full-screen) and
a split edit mode (source + live debounced preview, template picker,
Apply/Cancel, contained syntax errors, shared autosave and save status). Stored
content is opaque visual-page JSON; search indexes only the title, and dashboard
cards show the readable type label — never Mermaid source or SVG.

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
