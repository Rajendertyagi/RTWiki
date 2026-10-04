# ADR-021: One Shiki Engine and One Code-Language Registry for Both Surfaces

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-10-01 |
| **Deciders** | Project Owner, Lead Developer |
| **Affects** | [ADR-017](ADR-017-markdown-engine-micromark.md) (adds a post-render stage it did not describe), [ADR-003](ADR-003-react-blocknote-mantine.md) (the editor's code blocks), [DEVELOPMENT_STANDARDS](../DEVELOPMENT_STANDARDS.md) §5 |
| **Supersedes** | Nothing |

## Context

An audit of the Markdown pipeline found that **no syntax highlighting existed anywhere
in RTWiki**, on either surface. That is a stronger statement than "the Markdown
highlighting could be better", so it is worth recording exactly what was measured,
because two of the three findings were counter-intuitive.

**The Markdown viewer emitted a language class that nothing consumed.** `renderMarkdown`
produced `<pre><code class="language-js">`, and no code read that class. There was no
highlighter, no theme, and no token markup.

**The Rich Editor was in the same state, for a more interesting reason.**
`@blocknote/core` already contains a syntax-highlighting integration. It is simply
**opt-in and off by default** — the package's own types say so:

> Highlighting is opt-in: the user adds this extension to the editor's `extensions`
> (configured with a `createHighlighter`) to enable it. When it's absent, content
> renders as plain text.

RTWiki added no such extension, so the capability was present and unused. Worth noting
because the alternative reading — "BlockNote cannot highlight code" — would have justified
building a second highlighting system, when the correct action is one line.

**An external stylesheet was evaluated and rejected**, on measured grounds rather than
taste. `github-markdown-css` (43 KB light + dark, generated from GitHub's own CSS) was
the obvious candidate. It has **0 rules for `hljs-*`**; its `.pl-*` rules are **Prism**'s,
not highlight.js's. Adopting it would have delivered no syntax highlighting at all — the
one feature it was wanted for. It also hardcodes hex colours and sets
`color-scheme: light` on its root selector, which would fight Mantine's colour scheme.

## Decision

**Shiki is the highlighting engine, shared by the Markdown viewer and the Rich Editor,
described by one registry in `src/web/features/code/code-registry.ts`.**

```text
  code-registry.ts          aliases, languages, themes — data, no engine
         ↓
  shiki-service.ts          one lazy HighlighterCore instance
         ↓                    ↘                     ↙
  markdown-code-highlight   markdown preview     blocknote-shiki.ts
```

### Why Shiki, specifically

Because BlockNote's ecosystem already integrates it and that integration was found
present and disabled. Supplying the `createHighlighter` callback BlockNote already
expects turns the Rich Editor on **and** gives the Markdown viewer the same engine,
grammars, themes and alias table. `prosemirror-highlight/shiki`, which BlockNote
imports, declares `@shikijs/types` as a dependency; it was already in the lockfile.

A second engine would have been a correctness problem, not only a size one: two
independent highlighter instances mean the same fence can render differently depending
on which surface rendered it.

### Why a registry, and why a data file

The audit found the same kind of knowledge duplicated, with nothing keeping the copies
in step: a fence's language lived as a raw class name that nothing read, and there was
no place at all for `js → javascript` to live. The registry is the one place a language,
its aliases, its theme and its loader are declared. Adding a language is one array entry
and nothing else — not the renderer, not the Markdown pass, not the editor.

The registry holds **twelve** languages, not all ~200 Shiki grammars.
`@shikijs/langs` measures **7.6 MB across 321 files**, so each entry costs one
lazily-fetched chunk and a note never mentioning Rust never fetches the Rust grammar.

### Why highlighting is a post-render pass, not a parser stage

micromark's compiler is synchronous; Shiki is not. The parser therefore emits the fence's
text and something fills it in afterwards.

**This is not a workaround invented for Shiki — it is the pattern the codebase already
uses.** `markdown-mermaid.ts` emits a `<div class="rt-mermaid">` placeholder and
`markdown-mermaid-hydrate.ts` fills it in, because `mermaid.render()` is also async.
Following the established shape means a future agent changing diagram behaviour finds
the highlighting pass beside it and recognises the pattern, rather than meeting a second
mechanism.

Making `renderMarkdown` async was considered and rejected: it would force every caller
to become async, and `markdown-workspace.tsx` computes the preview in a `useMemo` that
must return a string.

### Grammars and themes load on demand, individually

An earlier implementation of this work built the highlighter with all twelve registry
languages at once. **Measured cost: 1237 ms before the first fenced block could be
highlighted, and 456 KB of grammar chunks** for a note containing one JavaScript block.
The grammar chunks are individually lazy, but loading twelve in one `Promise.all` defeats
that completely.

So the engine is created with **no languages and no themes**, and each is added as it is
first needed: `import('@shikijs/langs/python')` is its own chunk. Re-measured: **872 ms**
cold for the first fence, ~26 ms per additional language, ~9 ms for a language already
loaded. `tests/shiki-service.test.ts` asserts the property rather than the timing — a
highlighter holding only the languages a note actually used.

### The JavaScript regex engine, not Oniguruma

`createHighlighterCore` needs a regex engine. Oniguruma is the reference implementation
and marginally more correct on some TextMate edge cases, but it means a `.wasm` fetch plus
a worker pool. The JavaScript engine is a 4.9 KB dependency with no WASM and no worker,
which is the right trade for a local desktop app. If a grammar ever misbehaves here and
not in Oniguruma, this is the first thing to change.

### Callouts use the existing directive system, with no new extension

`:::note` … `:::` renders as a styled panel. **The parser half already existed** —
`micromark-extension-directive` is configured and `:::columns` proves the container path —
so this adds one handler and no parser extension.

The variant set is the Rich Editor's (`info`, `note`, `tip`, `warning`, `danger`, from
`callout.module.css`), **not** GitHub's alerts (`caution`, `important`). Reusing the
existing names is what makes a Markdown callout and a Rich Note callout read as the same
feature; the tints are the same Mantine tokens at the same `color-mix` percentages.

**A titled callout is `:::note` with `**Title**` on the first line**, not
`:::note Title`. Measured: every form was rendered through the real pipeline, and a label
after the directive name makes micromark parse the whole block as inline text —
`:::note Derivation` renders as a paragraph, while `:::note` alone is a directive. The
title is therefore *detected* structurally: a body whose first block is a paragraph
containing nothing but a `<strong>` becomes the title. Forcing the directive grammar to
support titles would buy nothing a reader can see.

## Consequences

**Positive**

- Syntax highlighting on both surfaces, from one engine and one alias table.
- A new language costs one registry entry and one lazily-fetched chunk.
- A new callout variant costs one registry entry and one CSS rule — not a new handler.
- No external stylesheet, and no hex values in the content stylesheet: every colour is a
  Mantine token or a `color-mix` of one, which is what makes both colour schemes work.
- Raw HTML remains escaped and inert. Unchanged and asserted by
  `tests/markdown-raw-html-policy.test.ts`.

**Negative, and stated plainly**

- **Four runtime dependencies** were added (`shiki`, `@shikijs/langs`,
  `@shikijs/themes`, `@shikijs/engine-javascript`). They are all lazy, but they are real.
- **First highlight on a page costs ~872 ms.** Not on page open — on the first fenced
  block, and the block renders as plain text until it lands. A visible pause on a note
  whose first code block appears high in the document.
- **The registry is a hand-maintained list of twelve.** A language outside it stays plain
  rather than erroring, which is the required behaviour, but it is a limit on coverage.
- **Shiki bakes colours into HTML**, so a scheme change re-renders every code block
  rather than restyling in CSS. This is the same constraint Mermaid already has and the
  reason both passes are keyed on `colorScheme`.

**A stylesheet-scoping trap, recorded because it cost a full browser run**

The content stylesheet was first scoped under `.previewPane`. **That matched nothing.**
`previewPane` is a class in a **CSS module**, so it is emitted hashed as
`._previewPane_1ndoc_42`, and a global stylesheet cannot select on the literal name. All
11.94 KB shipped and every rule was dead.

The unit tests could not catch this: `tests/markdown-content-styles.test.ts` asserts the
rules are *shipped*, which they were. Only a computed-style assertion in a browser found
it. The stylesheet is therefore scoped under `[data-rt-markdown-preview]`, an attribute
that survives the module hash — and the test now asserts both that the stylesheet names
the attribute and that the element carries it.

## Alternatives considered

| Option | Why not |
|--------|---------|
| `github-markdown-css` | 0 `hljs` rules; hardcoded light palette; `.markdown-body` root selector RTWiki does not use |
| highlight.js | A second engine alongside BlockNote's Shiki wiring — the exact duplication this ADR exists to prevent |
| Prism | Would suit `github-markdown-css`'s `.pl-*`, but BlockNote integrates Shiki |
| MDX | Forbidden by the task and by [AGENTS.md](../../AGENTS.md) §4 |
| Async `renderMarkdown` | Forces every caller async; `useMemo` must return a string |
| Inline `if (lang === 'js')` dispatch | The scattered-conditionals pattern §14 rules out; a registry replaces it |
