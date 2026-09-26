# ADR-012: Diagram Rendering and Sanitisation Contract

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-09-27 |
| **Deciders** | Project Owner, Lead Developer |
| **Supersedes** | — |

## Context

RTWiki renders Mermaid diagrams in two places: as a block inside a Rich Note
(`mermaid-block-view.tsx`) and as a whole page type (`mermaid-workspace.tsx`). Both call one
shared render path, `mermaid-render.ts`, which returns SVG that is then passed through
`sanitizeDiagramSvg` before it reaches the DOM.

`sanitizeDiagramSvg` exists as defence in depth. Mermaid already runs under
`securityLevel: 'strict'` and sanitises label HTML itself, but RTWiki does not rely on the
generator: the sanitiser structurally removes `script`, `iframe`, `object`, `embed` and
**`foreignObject`**, strips every `on*` attribute, and restricts `href`/`xlink:href`/`src` to
fragment-only references.

Two things about Mermaid 12 made that sanitiser wrong in a way nothing detected.

**Mermaid emits labels as HTML inside `<foreignObject>` by default.** So `sanitizeDiagramSvg`
deleted the `foreignObject` holding every node label. The result was that **every diagram in
RTWiki rendered with no labels at all** — shapes and connectors, no text — for every diagram
type, on every page, in both the block and the page workspace. The rendered `viewBox` was even
tall enough to show that space had been reserved for labels that were not there.

It was not caught because every existing assertion was of the form "an `<svg>` appeared". A
label-less diagram still has an `<svg>`. The browser suite passed, the unit suite passed, and
the CSP was correct.

**A second, smaller instance of the same class of problem:** the Content-Security-Policy sets
`style-src 'self' 'unsafe-inline'`, which is what allows Mermaid's injected `<style>` to apply.
Nothing asserted that directive, so tightening the CSP would have unstyled every stored diagram
with no test failing.

## Decision

### 1. Mermaid renders labels as SVG text, not HTML

`MERMAID_CONFIG` sets `htmlLabels: false`. Mermaid then emits labels as SVG `<text>` elements.

This is the fix and also the safer configuration. An SVG `<text>` element cannot carry a script
element, an event handler, or arbitrary HTML, so the class of content the sanitiser was
stripping `foreignObject` to remove never reaches the output in the first place. The rendered
markup is smaller and cheaper to parse than the `foreignObject` alternative.

The sanitiser's `foreignObject` removal is **kept**. It is still correct for any diagram type or
Mermaid feature that might emit one, and defence in depth is the point of the module. It is now
a backstop rather than something the renderer depends on.

### 2. Mermaid configuration is a single frozen object, pinned by tests

All Mermaid settings live in one frozen `MERMAID_CONFIG`. Several are load-bearing in ways that
are invisible if they are removed, and each is asserted in `tests/mermaid-security.test.ts`:

| Key | Why it is pinned |
|-----|-----------------|
| `htmlLabels: false` | Without it every diagram loses its labels (above). |
| `layout: 'dagre'` | Mermaid 12 makes ELK the default; dropping this re-lays-out every stored diagram and pulls in the ELK chunk. |
| `look: 'classic'` | Mermaid 12 defaults to `redux-color`/`neo`; dropping this recolours every diagram and breaks dark-mode agreement. |
| `mindmap: { layout: 'cose-bilkent' }` | Since Mermaid 11 the mindmap resolves layout through the registry, so the global `dagre` would otherwise capture mindmaps too. |
| `securityLevel: 'strict'` | Mermaid's own sanitisation of labels and its disabling of click callbacks. |
| `deterministicIDSeed` | Stable SVG ids across renders, so a re-render produces a byte-identical document. Capital `D` — this is Mermaid's spelling, and the previous `deterministicIdSeed` was silently never read. |

### 3. The Content-Security-Policy is an exported, asserted object

`APP_CONTENT_SECURITY_POLICY` is exported from `app.ts` and consumed by
`tests/security-headers.test.ts`, which pins `style-src` (Mermaid's injected stylesheet), keeps
`script-src` free of `'unsafe-inline'` and `'unsafe-eval'`, and fails if any directive is ever
widened to a wildcard.

### 4. Colour scheme is decided per render, not once

Both call sites read `useComputedColorScheme` and pass `theme: 'dark' | 'default'` on **every**
render, not only when the scheme changes. Mermaid's configuration is module-global, so this is
serialised through a mutex and a fresh id per render.

**Verified, not assumed:** in light mode Mermaid emits `.label { color: #333 }` against a white
page; in dark mode it emits `.label { color: #ccc }` against `rgb(36, 36, 36)`. The theme is
applied and agrees with the rest of the application.

### 5. Overflow panels are rebuilt as real menu rows, never moved as nodes

Wherever a toolbar cannot fit its controls in one row, the controls that do not fit move into a
trailing panel measured by the shared `useToolbarOverflow` hook. The panel's contents depend on
what it holds, and the two surfaces differ deliberately:

- **Diagram template bar** — holds a fixed set of simple buttons, so the panel is a Mantine
  `Menu` of real `Menu.Item` / `Menu.Sub` rows. Variants (Flowchart's four directions, State's
  two syntaxes) use `Menu.Sub`, which is Mantine's documented nesting mechanism. Rendering rows
  rather than moving nodes is what makes the submenu open and the panel keyboard-reachable.
- **Rich document toolbar** — holds arbitrary BlockNote editor controls, some of which own their
  own floating overlays, so the panel is a Mantine `Popover`. A `Menu` would assert
  `role="menu"` over children with no `menuitem` role and move focus by querying
  `[data-menu-item]`, which none of them carry — a keyboard user could not get in at all. A
  `Popover` is what a panel of controls actually is. `trapFocus` moves focus inside on open, so
  the `role="dialog"` Mantine assigns is honest.

## Alternatives Considered

| Alternative | Reason for Rejection |
|-------------|---------------------|
| Keep HTML labels and sanitise `foreignObject` content instead of removing it | Requires sanitising HTML inside an SVG foreign context, reintroducing exactly the parsing surface the removal avoided. `htmlLabels: false` removes the need rather than managing it. |
| Remove `foreignObject` from `REMOVE_ELEMENTS` | Directly reintroduces the risk the sanitiser exists to prevent, in exchange for labels that `<text>` provides safely. |
| Re-serialise diagrams to PNG/SVG files on disk | Breaks canonical BlockNote JSON storage ([ADR-004](ADR-004-canonical-block-json-format.md)), makes diagrams non-editable in place, and adds a file-lifecycle concern to a portable layout ([ADR-005](ADR-005-portable-data-layout.md)). |
| Assert only that a diagram rendered | This is the assertion that let the label defect through. Assertions are about label text, not the presence of an `<svg>`. |
| Convert the rich toolbar's overflowed controls to `Menu.Item`s | Would mean redeclaring ~24 controls and abandoning "moved whole, nothing re-implemented", which is what lets a popover-backed or stateful control behave identically in the panel. `Popover` achieves keyboard access without that cost. |
| `useCallback`-wrap the rich toolbar's overflow target toggle only | A controlled `Popover` never attaches its own target toggle, so the `onClick` is required, not a workaround. Confirmed in Mantine's `PopoverTarget` source: the handler is added only `!ctx.controlled`. |

## Consequences

**Positive:**

- Diagrams show their labels, on every page, for every type.
- Label text cannot carry script or event handlers, so the sanitiser's role shrinks to a
  backstop rather than the primary defence.
- A regression that removes labels is now caught by
  `tests/browser/diagram-labels.pwspec.ts`, which asserts on label text and on the absence of
  `foreignObject`.
- Dark-mode rendering of diagrams is measured, not assumed.
- The CSP directives diagrams depend on are asserted, so a future tightening cannot silently
  unstyle the database.
- Both overflow panels are keyboard-reachable, with ARIA that matches their contents.

**Negative:**

- `htmlLabels: false` is a Mermaid-wide setting: it applies to every diagram type, including any
  added later. A type that genuinely requires HTML labels would need a deliberate, reviewed
  exception rather than a per-diagram toggle.
- Mermaid's `<text>` labels do not wrap the way HTML labels can, so a very long node label
  relies on Mermaid's own truncation rather than CSS wrapping.
- The two overflow panels use different Mantine components. This is intentional and documented
  above, but it is a difference a future reader must not "fix" for consistency's sake.

**Neutral:**

- `svg-sanitize.ts` is unchanged; only the renderer's configuration changed.

## Risks

- **A future Mermaid upgrade changes the label default again:** mitigated by the unit assertion on
  `htmlLabels` and by `diagram-labels.pwspec.ts`, which fails if `foreignObject` reappears in
  rendered output.
- **`htmlLabels: false` regresses a diagram type's appearance:** mitigated by the 21-template
  render test in `diagram-templates.pwspec.ts`, which renders every offered type.
- **The `Popover`/`Menu` split is "corrected" for consistency:** mitigated by the reasoning in
  this ADR, restated at the call site, and by the keyboard test that fails if the rich panel
  becomes a `Menu` again.
- **The `style-src` allowance is removed in a future CSP tightening:** mitigated by
  `tests/security-headers.test.ts`.

## Revisit Conditions

- If Mermaid exposes supported HTML labels that cannot be expressed as `<text>`, revisit whether
  per-diagram label handling is worth the sanitisation surface.
- If a diagram type is added that requires `foreignObject` for correct output, this ADR must be
  superseded rather than worked around.
- If the rich toolbar's controls are ever restructured into genuine menu items, the overflow panel
  should move to `Menu` and this ADR updated.

## Cross-References

- [ADR-003](ADR-003-react-blocknote-mantine.md) — frontend stack; Mantine's `Menu`/`Popover` semantics
- [ADR-004](ADR-004-canonical-block-json-format.md) — canonical BlockNote JSON storage for diagram blocks
- [ADR-005](ADR-005-portable-data-layout.md) — portable data layout
- [ADR-006](ADR-006-rich-content-and-import-contract.md) — block registry and the diagram block module
- [ADR-007](ADR-007-sandboxed-custom-content.md) — L3 sandbox; **not** required for diagrams, which stay L1
- [SECURITY.md](../SECURITY.md) — sanitisation and CSP
- [DEVELOPMENT_STANDARDS.md](../DEVELOPMENT_STANDARDS.md) — modular block architecture rules
- [KNOWN_BUGS.md](../KNOWN_BUGS.md) — the measured account of the label defect and the CI gate failures
