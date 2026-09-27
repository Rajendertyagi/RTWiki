# ADR-017: Markdown Engine — micromark

**Status:** Accepted. Supersedes the implicit assumption that `marked` is RTWiki's Markdown engine.

**Date accepted:** 2026-09-27, by the project owner, after an empirical comparison.

---

## Context

A Markdown page is rendered by one pure function: source → HTML → sanitise → inject. A second,
independent parse produces the heading outline for the right-hand panel. Until now both used
`marked`, and both were therefore structurally guaranteed to agree about which lines are headings.

That property was load-bearing. The outline and the preview must agree or clicking an entry scrolls to
the wrong place, and a hand-written `^#{1,6}` scan disagrees with any real parser in at least three
ways — a `#` line inside a fence is code, a setext `===` heading has no leading `#`, and an indented
line is a code block.

`marked` was never chosen against anything. It was the first thing that worked, and two features later
the project needed Markdown extensions — maths, directive containers, fenced diagrams — none of which
`marked` offers a clean path to. Rather than bolt extensions onto a parser that was not designed for
them, the engine was chosen by measurement.

## Decision

**The Markdown engine is `micromark`, composed with `micromark-extension-gfm`.** The outline uses
`mdast-util-from-markdown`. `marked` is removed from the project.

The comparison was empirical, across `markdown-it`, `md4x` and `markdown-to-jsx`. The parser choice is
settled and is not revisited here.

### Two properties decided the outcome

**Extensions are the composable kind.** `micromark` is a state machine with a documented
`htmlExtensions` hook, so a fence can be intercepted and replaced and everything else is left alone.
The requirement this project actually has — byte-identical output for every fence that is *not* a
diagram — is a property you can only have if the hook is a hook rather than a plugin you reimplement.

**The outline can read the same tree the renderer builds.** `mdast-util-from-markdown` yields the
document as a tree, so a heading's text is available resolved. `marked.lexer` gave the **raw source**
of the heading — `"Sub *head*"` — which had to be run back through an inline renderer and stripped of
tags to recover `"Sub head"`. That round trip is gone rather than merely relocated.

## The `SAFE_FOR_XML` finding

**DOMPurify strips any attribute whose value matches `/((--!?|])>)|<\/(style|script|…)/i`.** Mermaid's
arrow syntax is literally `-->`. Measured: `data-chart="A-->B"` loses the attribute entirely.

`ADD_ATTR`, `ALLOWED_ATTR` and `ALLOWED_URI_REGEXP` do **not** help. Only `SAFE_FOR_XML: false` does,
and that weakens a security control that exists to stop mXSS, so it is not an option.

**The consequence is a design rule, not a workaround: diagram source is carried as `<pre>` text
content and never as an attribute.** This is not a workaround chosen for convenience — it is the only
shape that survives the sanitiser without turning a control off.

## The sanitiser change, and why it is smaller than it looks

The profile was `USE_PROFILES: { html: true }`, which silently removed **every** `<math>` and **every**
`<svg>`. Measured: one of each in, zero of each out — while the surrounding
`<span class="katex-html">` survived byte-identically. That is why the breakage was invisible: a DOM
snapshot looked perfect. A KaTeX radical is a MathML `<msqrt>` with an SVG overlay, so `\sqrt{2}` was
losing both and rendering as a bare `2`, and maths were invisible to a screen reader.

Widening to `{ html: true, mathMl: true, svg: true, svgFilters: true }` restores both.

**The widening is smaller than the profile diff suggests, and that is worth stating plainly.** Because
micromark **escapes raw HTML**, a user cannot get `<math>` or `<svg>` into the sanitiser at all — the
characters arrive as escaped text. The only MathML or SVG that ever reaches the sanitiser is markup
RTWiki generated itself. So the change widens what *our own* output may contain, not what a user's
keystrokes can, and the two foreign-content profiles were checked against the attacks they could
plausibly admit rather than assumed safe:

| Markup | Result |
|---|---|
| `<math><mtext><script>` | script removed |
| `<svg><script>` | script removed |
| `<svg><animate onbegin=…>` | handler removed |
| `<svg><a xlink:href="javascript:">` | scheme removed |
| `<math><annotation-xml encoding="text/html"><script>` | script removed |
| `<style>` with the svg profile on | removed — `FORBID_TAGS` still wins |

## Accepted consequence: raw HTML in Markdown is now inert

`<b>x</b>` in Markdown source now renders as the visible text `<b>x</b>`. `marked` passed it through as
an element.

**This is intentional and desirable.** RTWiki's security rules forbid raw HTML execution inside
Markdown, and the old arrangement left the entire burden on the sanitiser. The parser now enforces it
at the source, so a parser bug is no longer the only thing standing between a note and script
execution. It is user-visible, so it is recorded here and asserted by a test.

## Maths

`micromark-extension-math` is composed into the same single `MARKDOWN_OPTIONS` as GFM, so maths and
Markdown cannot drift apart. KaTeX does the rendering, at parse time, into the same HTML string the
sanitiser then processes.

### The sanitiser widening is what makes this possible

`\sqrt{2}` is a MathML `<msqrt>` with an SVG overlay. The `{ html: true }` profile deleted both, so
this extension **could not have worked** without the widening above. That is the concrete load the
widening was taken for, and it is now measured rather than predicted: a real browser renders the
radical, the SVG overlay is in the DOM, and the MathML subtree survives for a screen reader.
Evidence: `docs/evidence/markdown-math-proof.png` and `markdown-math-zoom.png`.

### `trust: false` is pinned, not defaulted

KaTeX's `trust` flag gates `\href`, `\url`, `\htmlClass`, `\htmlId`, `\htmlData` and
`\includegraphics`. With it on, TeX in a note is an injection vector — a study note containing
`\href{javascript:alert(1)}{click}` produces a live link in RTWiki's own origin. It is set explicitly
so a future KaTeX release cannot quietly change what the default means, and the effect is asserted
rather than the flag: all six commands are fed through the real pipeline and the DOM is audited.

`throwOnError: false` for the same reason of robustness rather than safety: with throwing enabled, one
malformed expression makes the whole preview fail to render, so a single typo would blank a note.
Disabled, KaTeX shows the source in its error colour and the rest of the page survives.

### The inline `$` delimiter is RTWiki's own construct, on GitHub's rule

`micromark-extension-math@3.1.0` decides inline maths by **marker count**, not by character adjacency.
From `dev/lib/math-text.js`:

```js
let single = options_.singleDollarTextMath
if (single === null || single === undefined) single = true
// Not enough markers in the sequence.
if (sizeOpen < 2 && !single) return nok(code)
```

So one `$` opens maths and **anything** may sit between the delimiters. Measured consequences:

| Source | Package's behaviour | GitHub's rule |
|---|---|---|
| `Only $100.` | text ✓ | text |
| `Pay $5 or $10 today.` | **maths** ✗ | text |
| `Between $3 and $4.` | **maths** ✗ | text |
| `It cost $20,000 and $30,000 won.` | **maths** ✗ | text |
| `value $E=mc^2$ here` | maths ✓ | maths |

**There is no option for the correct rule.** The single boolean governs marker count; nothing in the
package governs adjacency. The earlier note in this ADR recorded the false positive as "a deliberate
choice with a known cost" — that was wrong. It is a **defect with no configuration that fixes it**, and
the earlier framing mistook the absence of a fix for a decision. Correcting that framing is the purpose
of this amendment.

RTWiki therefore owns the inline construct, in
[`math-inline-github-rule.ts`](../../src/web/features/markdown/math-inline-github-rule.ts). It implements
GitHub's documented rule, which is three adjacency conditions:

1. the opening `$` is followed by a **non-whitespace** character;
2. the closing `$` is preceded by a **non-whitespace** character;
3. the closing `$` is **not** followed immediately by a **digit**.

Everything else stays with the package. `math()` returns `{ flow, text }`; its **`flow`** is reused
unchanged, so `$$` handling is untouched, and only **`text`** is substituted. `mathHtml()` is the package's
unchanged, because it is the KaTeX renderer and it is correct.

**Two pieces of the package's tokenizer are carried over on purpose**, because they are correct and
re-deriving them would mean re-deriving them wrongly: the marker-run matching (`sizeOpen`/`size`, without
which the construct opened maths on an empty `$$` and silently lost the fraction inside) and the
`previous` guard (a `$` directly after another `$` does not open inline maths; a `$` after a backslash
escape does, so `\$x$` still works). Neither touches the adjacency decision.

#### Attribution and licence

The state-machine shape — `start` → `sequenceOpen` → `between` → `data` → `sequenceClose` — and the
`effects.enter`/`consume`/`exit` protocol follow **`micromark-extension-math`**, which is MIT-licensed, by
Titus Wormer (<https://github.com/micromark/micromark-extension-math>). The token names `mathText`,
`mathTextSequence` and `mathTextData` are that package's, because `mathHtml` matches on them and they are
its public serialisation contract. The delimiter logic is ours and is not copied. This is one construct in
one file, not a fork or a vendored package.

#### The maintenance trade, stated honestly

**We now own this tokenizer instead of receiving it from a maintainer.** A bug in it is ours to fix, and a
security or correctness fix upstream in the adjacency logic will not reach RTWiki. That is the deliberate,
permanent cost of correct behaviour and GitHub parity, and it is paid for ~150 lines in one file whose
entire surface is the table of delimiters above. The alternative was shipping prose that renders as an
equation, which for a study-notes application is a worse and more visible failure.

#### Measured boundary

`$a$$b$` is **one** expression whose TeX source is `a$$b`, which KaTeX reports as an error and shows the
source for. This is **not** a regression: the package was measured against this construct and produces
byte-identical output for `$a$$b$`, `x $a$$b$ y`, `$a$$b$ $c$`, `$$x$$`, `$a$ $b$` and `$a$$b`. Two adjacent
expressions need a space — `$a$ $b$` is two. Written up in [KNOWN_BUGS.md](../KNOWN_BUGS.md) and pinned
by a test.

`$x$` inside link **text** does render maths, matching GitHub. Link destinations, image alt text, image
titles, autolinks, code spans and fences do not. Text content is parsed; attribute content is not.

### Display maths needs the multi-line form

`$$` on its own line with the content between produces `<div class="math math-display">`. Written on
one line, `$$x$$` produces **inline** maths — the extension only reaches its flow construct when the
opening `$$` is alone on a line. The expression is still correct; only the presentation differs. Asserted
both ways.

## Alternatives considered

**`markdown-it`.** A capable parser with a real plugin API, and the most natural fit if extensions were
the only requirement. Rejected because `markdown-it-container` — the standard route to `:::` blocks —
**cannot accept attributes** without a hand-written validator. `:::columns{size="60 40"}` is the
requirement, so the plugin would have needed replacing rather than configuring.

**`md4x`.** Faster, and offers a synchronous highlighter, which is genuinely tempting for fenced
diagrams. Rejected: the highlighter is the one extension point it has, which forecloses everything
else, and its custom-element model does not compose with the sanitiser contract used here.

**`markdown-to-jsx`.** Convenient React output. Rejected: it renders React rather than producing a
string, so the pipeline's sanitise-then-inject stage — the thing that makes the security model
checkable at all — has nowhere to sit.

**Keeping `marked` and writing the extensions by hand.** Rejected as the worst of both: a
reimplementation of parsing behaviour is a second source of truth for Markdown semantics, and the
byte-parity requirement would be measured against our own code rather than an independent one.

## Consequences

**Easier:** extensions compose instead of being bolted on; the outline reads resolved heading text
directly; raw HTML is inert at the parser rather than at the sanitiser; the task-list stylesheet rule
finally matches something.

**Harder:** a behaviour change users can see (raw HTML now displays as text). Two dependencies added
rather than one, because the outline needs the tree and the renderer needs the HTML.

## Risks

- **Two parses of the same document, by two libraries.** `micromark` renders and
  `mdast-util-from-markdown` outlines. They share a grammar but are separate implementations, so the
  structural agreement the outline depends on is now a tested property rather than a structural
  guarantee. `tests/markdown-outline.test.ts` asserts the cases where they would disagree — fenced
  `#` lines, setext headings, indented code — which is what keeps the property honest.
- **Extension output is trusted by the sanitiser's profile.** Maths and diagrams will emit MathML and
  SVG. That is the intended use of the widened profile and the risk table above is the check on it,
  but it does mean an extension bug becomes a sanitiser input.
- **Behaviour change on existing notes.** Any note containing raw HTML renders differently after this
  change. Not measured across the user's real notes; the change is deliberate.

## Revisit conditions

- The app gains multi-user or LAN access, at which point a parser that runs in a worker, or a build
  that is not shipped to the client, becomes worth reconsidering.
- A dependency in the chain turns out to be unmaintained. All four are from the same author and
  released together, which is a concentration risk as well as a consistency benefit.

## Cross-references

- [ADR-004](ADR-004-canonical-block-json-format.md) — Markdown is an import/export format, never
  the canonical storage.
- [ADR-012](ADR-012-diagram-rendering-and-sanitisation.md) — the diagram sanitisation contract this
  engine's `SAFE_FOR_XML` finding constrains.
- [ADR-013](ADR-013-image-attachments.md) — the byte-first identification rule the same
  "never trust the claim, read the bytes" reasoning produced for attachments.
- [SECURITY.md](../SECURITY.md) — DOMPurify configuration and the raw-HTML prohibition.
- [KNOWN_BUGS.md](../KNOWN_BUGS.md) — the dead stylesheet rule this fixed, and the harness facts
  recorded alongside it.
