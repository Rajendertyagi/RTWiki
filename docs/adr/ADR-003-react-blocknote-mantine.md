# ADR-003: React, BlockNote, and Mantine

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-08-19 |
| **Deciders** | Project Owner, Lead Developer |
| **Supersedes** | — |

## Context

RTWiki needs a frontend framework, a block-based editor, and a UI component library. The constraints are:

- The editor must support drag-and-drop block rearrangement, a slash menu, and a formatting toolbar out of the box.
- The editor must support rich block types: headings, lists, checklists, quotes, tables, code blocks, images, cards, tabs, callouts, grids, formulas, and Mermaid diagrams (including mind maps). Cards, tabs, callouts, and grids are implemented as **first-class BlockNote custom blocks** (L1), not ordinary HTML, so they survive import and round-trip editing. See [ADR-006](ADR-006-rich-content-and-import-contract.md).
- The UI must be clean, modern, and accessible with minimal custom styling effort.
- The stack must be TypeScript-native.
- The application must run offline with no CDN dependencies.
- Exact dependency versions must be compatible with each other; the newest version is not the primary selection criterion.
- Rich content frequently arrives from external AI tools, so cards, tabs, callouts, grids, formulas, and diagrams must be first-class native block types (L1) that survive import and round-trip editing without degrading to plain HTML.

## Decision

RTWiki uses the following frontend stack:

| Layer | Technology | Role |
|-------|-----------|------|
| Framework | **React** + TypeScript | Component-based UI with hooks. The exact React version will be selected and pinned during the implementation phase to be compatible with the selected stable BlockNote, Mantine, and Vite versions. Major versions must never float. |
| Build Tool | **Vite** | Fast development server with hot module replacement. Produces a production-optimized bundle. |
| Editor | **BlockNote** | Block-based editor with drag-and-drop, slash menu, and extensible block types. |
| Math Blocks | **@blocknote/math-block** | Adds inline and block mathematical formula support to BlockNote. |
| Diagram Blocks | **@blocknote/diagram-block** | Adds Mermaid diagram support (including mind maps) to BlockNote. |
| UI Library | **Mantine UI** | Comprehensive component library with built-in theme support, dark mode, and accessibility. |
| Icons | **Tabler Icons React** | Clean, consistent icon set with tree-shakeable imports. |

The frontend is built as a standard Vite project. All dependencies are installed locally and bundled at build time. No CDN links are used at runtime.

All dependency versions will be committed through the lockfile. Major versions must never float. Compatibility between React, BlockNote, Mantine, and Vite takes priority over selecting the newest available version.

## Alternatives Considered

| Alternative | Reason for Rejection |
|------------|---------------------|
| Slate.js + custom blocks | Powerful but requires building every block type from scratch. Too much effort for the MVP. |
| Tiptap (ProseMirror-based) | Excellent editor, but block-level drag-and-drop and the slash menu require additional packages and configuration. Less turnkey than BlockNote for this use case. |
| Quill.js | Older architecture. Limited support for complex block types like tables and cards. |
| TipTap + Mantine | Viable alternative, but BlockNote has built-in drag-and-drop and slash menu, reducing custom implementation. |
| Radix UI instead of Mantine | Radix provides unstyled primitives; Mantine provides styled components out of the box, which is faster for a non-technical owner who wants a polished look quickly. |
| Ant Design instead of Mantine | Heavier bundle size. Mantine's theming system is more flexible for light/dark mode switching. |

## Consequences

**Positive:**
- BlockNote provides drag-and-drop, slash menu, and formatting toolbar with minimal configuration.
- Mantine's theme system makes light/dark mode switching straightforward.
- `@blocknote/math-block` and `@blocknote/diagram-block` integrate natively with BlockNote's block model.
- React's ecosystem is mature with excellent TypeScript support.
- Vite's build is fast and produces a small, optimized production bundle.
- Pinning versions through the lockfile and prioritizing compatibility avoids breaking changes during the MVP.
- Cards, tabs, callouts, and grids are defined as BlockNote custom blocks registered in the block registry, so new rich block types can be added without editing a central switch (see [ADR-006](ADR-006-rich-content-and-import-contract.md)).

**Negative:**
- BlockNote is a relatively new project. API stability is good but future breaking changes are possible.
- `@blocknote/math-block` and `@blocknote/diagram-block` are community-maintained extensions. Their longevity depends on the BlockNote ecosystem.
- Mantine's large component library increases bundle size if not tree-shaken properly.
- The React version is not yet pinned; it will be selected during implementation, which means the exact version is a known unresolved item.

**Neutral:**
- Lazy loading of math and diagram blocks (as specified in [ARCHITECTURE.md](../ARCHITECTURE.md)) mitigates the initial bundle size concern.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| BlockNote API breaking change between versions | Low | Pin the BlockNote version in the lockfile and test upgrades carefully before applying. |
| Math or diagram block package is abandoned | Medium | Both packages are maintained by the BlockNote team. Monitor the ecosystem. If either is abandoned, evaluate whether Mermaid rendering can be implemented as a custom BlockNote block. |
| Bundle size exceeds acceptable limits | Low | Vite code splitting and lazy loading keep the initial bundle small. Monitor bundle size in CI (see [CI_CD.md](../CI_CD.md)). |
| React version incompatibility with BlockNote or Mantine | Low | Version selection during implementation prioritizes compatibility over recency. All three will be tested together before the lockfile is committed. |

## Revisit Conditions

This decision should be revisited if:
- BlockNote does not support a required block type (e.g., cards or tabs) and extending it is impractical.
- A significantly better editor emerges that addresses a gap in BlockNote's capabilities.
- The math or diagram block packages are deprecated and no viable replacement exists.
- React releases a major version that provides a material benefit and all dependent libraries have compatible builds.
