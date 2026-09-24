# ADR-010: Rich Note Chart Block (Future Feature)

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-09-09 |
| **Deciders** | Project Owner, Lead Developer |
| **Supersedes** | — |

## Context

RTWiki is a local-first study wiki built on BlockNote (canonical BlockNote JSON, [ADR-004](ADR-004-canonical-block-json-format.md)) with native custom blocks owned by a registry (cards, tabs, callouts, formulas, Mermaid diagrams/mind maps, images — [ADR-006](ADR-006-rich-content-and-import-contract.md)). Students using RTWiki routinely capture quantitative study material — exam scores over time, grade distributions, study-hour tracking, experiment/survey results, comparison tables — and want to visualise it inline without leaving the note or learning a charting syntax.

Today the only visualisation primitive is Mermaid (diagram/mind-map), which is text-syntax-driven and oriented to graphs/flows, not interactive data charts. There is no first-class, no-code way to drop a bar/line/pie/scatter chart into a page.

This ADR decides the shape of a **future** Rich Note "Chart" block. It is explicitly **out of scope for the current timetable, workspace tree, dashboard, and Markdown work**; it records the decision so a later implementation task can proceed without re-litigating design.

## Decision

### Integration: a native custom Rich Note block

The chart is a **custom BlockNote block** (`chart`), built with `createReactBlockSpec` exactly like the existing `diagram.tsx` / `mindmap.tsx` blocks, owned by its own module (type id, schema, editor, viewer, parser, serializer) and registered in the block registry + composition root. No central switch over block types ([ADR-006](ADR-006-rich-content-and-import-contract.md)). This keeps charts as L1 first-class content that survives import/round-trip editing.

### MVP chart types (and explicit exclusions)

Supported: **Bar, Line, Pie, Scatter** only.

Explicitly excluded from MVP: area, stacked, radar, heatmap, gauge, tree, graph, sankey, candlestick, boxplot, geographic/map, 3D (echarts-gl), and word-cloud. These are deferred future extensions (see below).

### Editing: guided form + editable data table (no JSON)

Normal users must never write ECharts `option` JSON. The block editor presents:
- A **chart-type selector** (Bar / Line / Pie / Scatter).
- A **guided options form** (title, show-legend toggle, axis/category labels, point/series names).
- An **editable data table** where the user types or pastes values (e.g. a categories column + one or more series columns). This mirrors the no-code feel of inserting a table or callout today.

The viewer renders the chart from the structured data; raw ECharts option editing is **deferred** (future extension, and only via the L3 sandbox if it requires executable callbacks — see Security).

### Stored chart data shape and backward compatibility

The block stores a **fixed, serialisable schema** of primitives (strings, numbers, booleans, enums) — never functions. Illustrative shape (final form decided at implementation):

```ts
type ChartType = 'bar' | 'line' | 'pie' | 'scatter'
interface ChartBlockProps {
  version: 1
  chartType: ChartType
  title?: string
  categories?: string[]          // x-axis / pie labels
  series: Array<{ name?: string; data: number[] }>
  showLegend?: boolean
}
```

Backward compatibility guarantees:
- Documents created before chart support open unchanged (they simply contain no chart blocks).
- The schema is versioned; missing/extra fields default gracefully and never throw during render.
- The block round-trips through BlockNote JSON ([ADR-004](ADR-004-canonical-block-json-format.md)) and the centralised note-package import pipeline ([ADR-006](ADR-006-rich-content-and-import-contract.md)) without data loss.
- If the chart renderer/dependency is unavailable, the block degrades to its **underlying data table** rather than breaking the page.

### Theme / light-dark rendering

ECharts renders to canvas or SVG. The viewer reads `data-mantine-color-scheme` on `<html>` (set by Mantine and the boot theme script) and applies a matching theme: `backgroundColor: 'transparent'` plus text/axis/grid colours derived from Mantine tokens (not hardcoded). It re-renders (`setOption`) when the colour scheme changes, so charts follow the app's light/dark mode seamlessly.

### Lazy loading and expected bundle impact

Following the existing `lazy(() => import('.../mermaid-workspace'))` pattern, the chart renderer (and `echarts`) is loaded via dynamic `import()` only when a chart block is first rendered. Expected impact: **zero on initial bundle**; chart code is split into an on-demand chunk. Tree-shaking (`echarts/core` + only `BarChart`/`LineChart`/`PieChart`/`ScatterChart` + `GridComponent`/`TooltipComponent`/`LegendComponent`) keeps that chunk small for the MVP types.

### Accessibility expectations

- Enable ECharts ARIA (`aria: { enabled: true, label }`) with a descriptive label/title.
- Provide a **text/table alternative** (the source data table) for screen readers.
- Support decal patterns for colour-blind users where the chart type allows.
- The chart container is keyboard-focusable with an accessible name.

### Security boundary: declarative data only

The stored chart config is a closed schema of primitives. The viewer **constructs the ECharts `option` object in code from validated data**; it never `eval`s, never treats any user string as code, and never accepts `function` values, `formatter` callbacks, arbitrary expressions, remote data URLs, or `<script>`. This keeps charts **L1** — safe in the main application context, with no ADR-007 sandbox required.

Excluded by policy: JavaScript formatter functions, event callbacks, `eval`/expression evaluation, remote/`fetch` data loading, and any script execution. If a future need arises for formatter functions, that path becomes **L3** and must run inside the ADR-007 sandbox.

### Dependency decision

`echarts` is **not added now**. It may be evaluated only in the future implementation task (spike/PR), with a pinned version and tree-shaking. This ADR makes **no** changes to `package.json`, the lockfile, or any source.

## Alternatives Considered

| Alternative | Reason for Rejection |
|-------------|---------------------|
| Fenced code block (```` ```echarts ```` with option JSON) | Requires writing ECharts JSON/JS — violates the no-code requirement and "normal users must not write ECharts JSON"; error-prone data entry, harder to theme/validate. Custom block gives a guided form + table. |
| Reuse Mermaid for charts | Mermaid is diagram-oriented with limited, less interactive chart support; unsuitable for data charts with editable tables. |
| Dedicated "Chart" page type (like the HTML page) | Charts are inline content within notes, not whole pages; a block reuses slash menu, copy/paste, and import and is the correct granularity. |
| Third-party React wrapper (`@echarts-for-react`) | A thin `init`/`dispose`/`resize` hook is sufficient; an extra dependency may lag React 19 and reduces bundle control. (The `echarts` dependency itself is deferred regardless.) |
| Store charts as static images | Loses interactivity and editability; contradicts canonical editable BlockNote JSON ([ADR-004](ADR-004-canonical-block-json-format.md)). |

## Consequences

**Positive:**
- Students visualise study data inline with zero coding, via a form + table.
- Charts are L1 native blocks: theme-aware, importable, and round-trip safe.
- No initial-bundle cost (lazy-loaded); no security surface added (declarative data only).

**Negative:**
- MVP covers only 4 chart types; richer visualisations wait for future extensions.
- Raw/advanced ECharts option editing is deferred, so power users cannot fine-tune via JSON yet.

**Neutral:**
- Adds a future runtime dependency on `echarts` (deferred to implementation).

## Security Model

Unchanged from the rest of the app. Charts are declarative L1 data rendered by application code; no user-supplied code executes, no network egress, no new endpoints. No CSP/sandbox/attachment changes ([SECURITY.md](../SECURITY.md), [ADR-007](ADR-007-sandboxed-custom-content.md)). If formatter functions are ever added, they move to the L3 sandbox.

## Risks

- **Scope creep into MVP:** mitigated by this ADR explicitly excluding charts from the current timetable/tree/dashboard/Markdown work.
- **Bundle size if not tree-shaken:** mitigated by lazy `import()` + `echarts/core` with only the 4 MVP charts/components.
- **Theme drift:** mitigated by deriving colours from Mantine tokens and re-rendering on scheme change.
- **Future raw-JSON editing weakening the security boundary:** mitigated by routing any executable option through the ADR-007 sandbox, not the main context.

## Revisit Conditions

- When the chart feature is scheduled for implementation, open the implementation ADR/spike.
- If owner wants more chart types (area/stacked/radar/heatmap/gauge/tree/graph), extend the supported set and the schema.
- If advanced raw ECharts `option` editing is requested, decide L1-data-only vs. L3-sandbox before allowing formatter functions.
- If workspace analytics, knowledge-graph, or page-link click actions are built on charts, extend this ADR accordingly.

## Future Extensions (explicitly deferred)

- **Advanced raw ECharts option JSON editing** — only via the L3 sandbox if it needs executable callbacks.
- **More chart types** — area, stacked, radar, heatmap, gauge, tree, graph, sankey, etc.
- **Workspace analytics** — auto-generated charts from page/tag/timestamp data.
- **Knowledge graph** — ECharts `graph`/`tree` of linked pages.
- **Page-link click actions** — chart point click navigates to a wiki page (reuse the existing wiki-link mechanism).

## Cross-References

- [ADR-003](ADR-003-react-blocknote-mantine.md) — frontend stack and native blocks
- [ADR-004](ADR-004-canonical-block-json-format.md) — canonical BlockNote JSON format
- [ADR-006](ADR-006-rich-content-and-import-contract.md) — rich-content model, block registry, note-package import
- [ADR-007](ADR-007-sandboxed-custom-content.md) — sandboxed custom content (L3, for any future executable option)
- [SECURITY.md](../SECURITY.md) — sanitization and sandbox security
- [DEVELOPMENT_STANDARDS.md](../DEVELOPMENT_STANDARDS.md) — modular block architecture rules
