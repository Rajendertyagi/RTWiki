# Reference Research

This document records the comparable tools and libraries researched while shaping RTWiki's rich-content architecture. The goal was to learn how other local-first and block-based knowledge tools handle rich AI-generated content, custom HTML/CSS/JS, and offline storage — and to adopt patterns that fit RTWiki's offline, localhost-only, no-account constraints. Official project sites are linked below; they are not runtime dependencies.

## Summary

| Tool | Type | What RTWiki borrowed / rejected |
|------|------|----------------------------------|
| Outline | Team wiki (server/cloud) | Rejected the server/account model; borrowed the clean block editing ideal. |
| TriliumNext | Local-first nested notes | Borrowed: rich content, scripts, offline-first; rejected cloud sync. |
| SiYuan | Local-first block workspace | Borrowed: block model + widget extensibility; the sandbox security model was independently designed (ADR-007). |
| AFFiNE | Local-first blocks + canvas | Borrowed: blocks as canonical unit; rejected cloud collaboration. |
| SilverBullet | Local-first Markdown + plugs | Borrowed: plugin/registry thinking; rejected raw-Markdown-as-primary. |
| TiddlyWiki | Single-file wiki | Borrowed: portable single-artifact philosophy; rejected tiddler JS-in-core. |
| Wiki.js | Node wiki (server) | Rejected server model; kept the clean docs structure. |
| BlockNote | Block editor library | Adopted as the editor (ADR-003); native custom blocks are L1. |
| Mermaid | Diagram library | Adopted for diagrams/mind maps (ADR-003); strict security mode for script prevention (SECURITY.md); network isolation provided by RTWiki's own CSP layer. |

## Tool Notes

### Outline
Official site: [Outline](https://www.getoutline.com)
A polished team wiki with a strong block editor. It is fundamentally a hosted/server product with accounts, which conflicts with RTWiki's offline, no-account model. RTWiki adopts the *idea* of frictionless block editing but not the deployment model.

### TriliumNext
Official site: [TriliumNext](https://triliumnext.eu) (source: [github.com/TriliumNext/Trilium](https://github.com/TriliumNext/Trilium))
A local-first, offline-capable knowledge base with deeply nested notes, rich content, and user scripts. It validates the "rich AI notes live happily on one local machine" approach. RTWiki mirrors its offline-first stance and avoids its optional sync.

### SiYuan
Official site: [SiYuan](https://b3log.org/siyuan)
A local-first, block-based workspace that supports custom widgets and JavaScript. SiYuan's widget extensibility demonstrated the value of per-block customization. RTWiki independently designed its L3 sandbox isolation (ADR-007): custom code is permitted in a per-page iframe sandbox with no same-origin access, never in the main application context.

### AFFiNE
Official site: [AFFiNE](https://affine.pro)
A local-first workspace built around blocks and a canvas. It reinforces treating blocks (not documents or Markdown) as the canonical unit. RTWiki follows this for L1 native blocks and rejects AFFiNE's cloud collaboration features.

### SilverBullet
Official site: [SilverBullet](https://silverbullet.md)
A local-first, Markdown-centric notebook with pluggable JavaScript. Its plug-in/registry pattern reinforced RTWiki's modular registry and composition-root design (DEVELOPMENT_STANDARDS.md). RTWiki deliberately does **not** adopt Markdown as the primary rich format — it is a fallback only.

### TiddlyWiki
Official site: [TiddlyWiki](https://tiddlywiki.com)
A single-file, portable wiki. It strongly validates RTWiki's portable-artifact goal (ADR-005): the whole workspace travels as one file/folder. RTWiki avoids TiddlyWiki's pattern of allowing arbitrary JS inside the core document.

### Wiki.js
Official site: [Wiki.js](https://js.wiki)
A capable Node.js wiki, but server/deployment-oriented. RTWiki keeps Wiki.js's clear documentation structure as inspiration but stays localhost-only and account-free.

### BlockNote
Official site: [BlockNote](https://www.blocknotejs.org) (source: [github.com/TypeCellOS/BlockNote](https://github.com/TypeCellOS/BlockNote))
The block editor RTWiki adopts (ADR-003). Its custom-block API is the foundation for L1 native blocks (cards, tabs, callouts, grids, formulas, diagrams). BlockNote JSON is the canonical storage format (ADR-004).

### Mermaid
Official site: [Mermaid](https://mermaid.js.org) (source: [github.com/mermaid-js/mermaid](https://github.com/mermaid-js/mermaid))
The diagram library used for Mermaid diagrams and mind maps (ADR-003). Mermaid's `securityLevel: "strict"` (the documented default) encodes HTML tags in diagram text and disables click functionality, preventing script injection within diagram content. External resource loading is prevented by RTWiki's own CSP and network restrictions, not by Mermaid itself. (Mermaid also documents a separate `securityLevel: "sandbox"` mode that renders in a sandboxed iframe — currently in beta — but RTWiki relies on its own CSP layer.)

## Lessons Applied

1. **Local-first wins for a family PC.** Every comparable tool that works offline validates RTWiki's no-cloud, no-account stance.
2. **Blocks, not Markdown, are the rich unit.** Tools that treat blocks as canonical (SiYuan, AFFiNE, BlockNote) preserve rich AI output better than Markdown-centric ones.
3. **Custom code needs a sandbox.** SiYuan's widgets and TiddlyWiki's JS show the value and the danger; RTWiki isolates L3 custom content (ADR-007).
4. **Portability matters.** TiddlyWiki's single-file approach matches RTWiki's portable-executable goal (ADR-005).
5. **A registry beats a switch.** SilverBullet's plugs and BlockNote's custom blocks support a modular, extensible architecture without central switch statements (DEVELOPMENT_STANDARDS.md).

## Cross-References

- [ARCHITECTURE.md](ARCHITECTURE.md) — how the research informs the design
- [ADR-003](adr/ADR-003-react-blocknote-mantine.md) — editor choice
- [ADR-004](adr/ADR-004-canonical-block-json-format.md) — canonical format
- [ADR-006](adr/ADR-006-rich-content-and-import-contract.md) — rich-content model
- [ADR-007](adr/ADR-007-sandboxed-custom-content.md) — sandboxed custom content
- [AI_CONTENT_IMPORT.md](AI_CONTENT_IMPORT.md) — the import contract that applies these lessons

## Security References

These official sources inform how RTWiki safely renders rich AI-generated and custom HTML content (see ADR-007):

- [MDN: iframe srcdoc security](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/srcdoc) — `srcdoc` injects HTML into a frame from the parent document; untrusted content must be strongly isolated, or it can reach the parent context.
- [MDN: CSP sandbox directive](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox) — a Content-Security-Policy `sandbox` adds a further restriction layer on what framed content is allowed to do.
- [DOMPurify](https://github.com/cure53/DOMPurify) — provides HTML/SVG/MathML sanitization. Sanitization is one layer and does **not** replace iframe sandboxing and CSP.

Arbitrary custom JavaScript must never run in RTWiki's main application context.
