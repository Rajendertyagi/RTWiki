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
expressions need a space — `$a$ $b$` is two. Pinned
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

## Amendment: directive containers, and the `SAFE_FOR_XML` finding applied to a width

**Status:** Accepted amendment. The engine decision above is unchanged; this records the first
construct built on it and the measured facts that shaped it.

### The brief, and why the shipped grammar is narrower than it

The `markdown-it-container` entry above names the requirement as `:::columns{size="60 40"}` — a free-form
CSS length pair. **What shipped is `:::columns{left=40}`: a single integer percent, right pane
`100 - left`, with no free-form CSS length at all.** That is a deliberate narrowing, and the ADR's own
`SAFE_FOR_XML` finding is the reason.

DOMPurify strips any attribute whose value matches `/((--!?|])>)|<\/(style|script|…)/i`, and it runs
**before** the allow-list, so `ADD_ATTR` and `ALLOWED_ATTR` cannot rescue it. Measured, against
`MARKDOWN_SANITIZE_OPTIONS`: `data-left="a-->b"` loses the attribute entirely, and so does
`data-left="a]>b"`.

Two measurements closed off the alternatives:

- **`this.encode` does not save it.** DOMPurify decodes entities before matching, so `a--&gt;b` is
  dropped exactly as `a-->b` is. Escaping at emit time is not a defence.
- **DOMPurify does not sanitise `style` attribute *contents*.** Measured: `style="width:expression(…)"`
  survives verbatim. So a free-form length validated by RTWiki's own code and copied into a `style` value
  is protected by *nothing* downstream — the sanitiser is not a second line of defence there, it is no line
  at all.

So the grammar is `/^\d{1,3}$/` plus a 1–99 range check. `-->` and `]>` are unreachable **by
construction** rather than filtered for afterwards, and the only string that ever reaches a `style`
attribute is `String(an integer this code parsed)`. A value outside the grammar is **surfaced** with a
visible notice naming the rejected value, never silently clamped — and the rejected value is echoed as
escaped **text**, which is the one place a document-supplied string is safe.

### The extension deletes unhandled content, and this is the finding that mattered most

`micromark-extension-directive`'s serialiser **buffers** a container directive's body and passes it to
the handler as `directive.content`; the extension never writes it. Measured consequences:

| Input | With a `columns` handler, **no** `'*'` fallback | With the fallback |
|---|---|---|
| `before\n\n:::warning\n**be careful**\n\nafter\n` | `<p>before</p>` — **two paragraphs silently lost** | name shown, `**be careful**` and `after` both present |

The unclosed fence swallowed the rest of the document, and the whole of it was discarded. No error is
raised, no warning is logged, and the preview looks like a successful render. **A `'*'` fallback is
therefore load-bearing, not defensive.** It is recorded as a standard in
[DEVELOPMENT_STANDARDS.md](../DEVELOPMENT_STANDARDS.md) §15.1, and asserted by a test.

Related, and the opposite of what the type suggests: **a handler emits with `this.tag()`/`this.raw()`,
not by returning a string.** micromark's compiler discards handler return values
(`micromark/lib/compile.js`: `handle.call({...context}, token)`, unassigned). The return value controls
only `found = result !== false` inside the extension's `exit()`, which decides whether the `'*'` fallback
runs — so a named handler returns `false` to hand a name over.

### Three syntax facts, all measured, none of them choices

- **No space before the name or the brace.** `::: columns` and `:::columns {left=40}` both render as a
  literal paragraph. Pandoc and Quarto *require* those spaces; reconciling that needs a fork of the
  tokeniser. Accepted, because the failure mode is a **visible literal paragraph** containing the reader's
  own text — never silent loss.
- **Nesting needs a strictly longer outer fence.** Measured across eight fence-length pairs: equal
  lengths leak the trailing fence as a stray paragraph (a 3/3 pair leaks `<p>:::</p>`, 4/4 leaks
  `<p>::::</p>`), while a strictly longer outer fence closes cleanly. Inherent to the extension, and
  pinned by a test so it is written down rather than discovered.
- **The pane separator is `***`, not `---`.** A `---` on the line directly after paragraph text is a
  **setext heading** in CommonMark, not a thematic break — measured: `Left text\n---\nRight text` compiles
  to `<h2>Left text</h2>` with no `<hr>` at all, so the divider would silently vanish and both panes would
  land in the left one. `***` and `___` are never setext underlines.

### Amendment: N columns, and the two ways a body can say where they end

**Status:** Accepted amendment. The engine decision and the two-pane form are unchanged; this records
the generalisation and the measured facts that shaped it.

### A block is two panes with a separator, or N panes with children

```
:::columns{left=40}      →  two panes, split at a *** thematic break
Left ***

Right :::
```

```
::::columns             →  N panes, one per :::column child
:::column{width=20}
First :::
:::column
Second :::
::::
```

Both forms are supported and the two-pane form is unchanged. They cannot conflict: a body either
contains pane children or it contains a separator.

### Nested directives compile inside out — measured, and it is the load-bearing fact

For `::::columns` with three `:::column` children, the handler call order is `column, column, column,
columns`, and the parent's `content` is already
`<div …>…</div>\n<div …>…</div>\n<div …>…</div>`. **So a child can render itself completely and the
parent only has to find the results.** Everything else follows from that.

### Passing children through the compile-data store was tried, and it loses content

The obvious alternative is a channel between the handlers, and micromark provides one: `this.setData`.
Measured: a `:::column` written **outside** any `::::columns` had its HTML pushed onto the store, never
reached the output buffer, and **vanished**. An orphan is not a syntax error — it is a reader whose
fences are slightly wrong — so deleting its content is precisely the failure this ADR's earlier section
records as the reason the `'*'` fallback exists. Rejected; children self-render instead.

Two more measured losses from the same direction, both fixed and both now tested:

- The first draft had the parent **wrap** each child's already-complete element, so two children
  produced four panes. The parent now unwraps each child and re-emits it.
- The first draft **discarded everything in the body that was not a child**. An unknown `:::warning`
  between two children lost its body and the text after it. Content that is not a pane is now emitted
  around the row, in reading order; its position relative to the panes is not preserved, and that is
  the accepted cost of not deleting it.

### Where widths live: on the child, not the root

A root-side list for N panes (`{width="30 30 40"}`) would need a **second grammar** — a
delimiter-separated list is a different parse — and a free-form one reintroduces exactly the
`SAFE_FOR_XML` problem above. Per-child `:::column{width=30}` reuses the *same* integer grammar per
child, needs no list parsing, and degrades naturally: a child with no `width` takes an equal share of
what the others leave. Measured: `{width=60}` with two undeclared siblings gives `60 / 20 / 20`, and
three undeclared children give `34 / 33 / 33`, summing to exactly 100.

The root keeps `left` for the two-pane form, where it is the one number that describes that form, and
it is **ignored when children are present** — with children present, the children are what have widths.

### Every pane grows by its own share, including the last

This is a bug worth recording, because the wrong version looks correct. The two-pane form shipped as
`flex: 0 0 40%` on the left and `flex: 1 1 0%` on the right — a *fixed* basis. Replacing that with a
uniform `flex: <share> 1 0%` and leaving the last pane at `1 1 0%` renders an authored **40% as
40/41 — about 98% of the row**, because grow factors are ratios. With every pane carrying its own share
the authored width is the rendered width. The shares need not sum to 100 for the geometry to be right
(flexbox normalises them); they are kept at 100 so the *announced* values mean what they say.

### N−1 dividers, each naming its own boundary

Measured for 2, 3, 4, 5, 8, 12 and 20 children: N panes, N−1 dividers, shares summing to 100. Dragging
divider *i* resizes the pane to its **left** and the rest of the row absorbs the change, so an N-pane
row is N independent boundaries rather than one shared budget to rebalance.

A two-pane row keeps the plain label it always had — one boundary needs no disambiguation, and the
everyday case should be announced exactly as it was. Three or more panes name each boundary:
`Resize columns: boundary 2 of 4, between column 2 and column 3`, with `aria-valuenow` the width of the
pane that boundary resizes. That is the value a drag changes, and therefore the one a reader can act on.

### The setext trap: made loud, but the *cause* cannot be reported

`Left text\n---\nRight text` is a **setext heading**, not a separator: it compiles to
`<h2>Left text</h2>` with no `<hr>` at all, so the divider silently vanishes. `***` and `___` are never
setext underlines, and a blank line before `---` also works.

**It cannot be detected.** Measured: that output is the same shape as `<h2>Genuine heading</h2>` from a
`##` the author meant, and nothing in the compiled HTML distinguishes them. So the block does not claim
a cause. It reports the fact it can observe — *no column separator was found* — names the form that
works, and shows a notice only when the body has content and no separator, so a genuine heading is not
accused of being a typo. The N-child form sidesteps the trap entirely: it has no separator to get wrong,
which is a real advantage of it above two panes and the reason to reach for it.

### Amendment: the stylesheet is a plain `.css`, and it needed a test that runs the build

**The feature rendered correct markup, passed 1030 unit tests, and was invisible in a browser.**
Twelve browser tests failed. Two independent faults, neither visible by reading the source:

| Fault | Measured |
|---|---|
| `.rt-cols` was a **local** CSS-module class, so the build hashed it | `rt-cols` appears in **zero** built stylesheets; the shipped CSS had no rule for it |
| the file was **bare-imported as a `.module.css`** | that import form emits no CSS at all here; a bare **plain** `.css` import does |

The second is the more interesting one, because it is a silent no-op. A module holding both a
class-map import of one stylesheet and a bare import of another emitted **only the first one's CSS**,
with no error. Every other bare CSS import in this app is a plain `.css`; this was the only bare
`.module.css` import in the codebase.

**Resolution:** `markdown-columns.css`, plain, global names, no `:global()` anywhere — that syntax is
only understood by the CSS-modules compiler, so in a plain stylesheet it reaches the browser verbatim
and matches nothing (measured: a plain `.css` with `:global(.rt-cols){display:flex}` builds cleanly
and emits exactly that). A CSS module is the wrong tool for markup emitted as a string, because it
hashes the very names the string cannot carry.

**The lesson is the test, not the CSS.** Every unit test was true: the renderer emitted `rt-cols`,
and `rt-cols` was written in the stylesheet source. Neither fact says a rule *ships*. The only thing
that can see the difference is the pipeline, so
`tests/markdown-columns-styles.test.ts` resolves the stylesheet **from the preview's own import**,
runs a real Vite build over it, and asserts every class the renderer emits has a rule in the CSS that
comes out. Against the shipped state it fails 11 of 13 assertions, including all six class rules, with
`no CSS rule shipped for .rt-cols; the markup would render unstyled`. It costs about 200 ms, writes
only to a temp directory, and is not skippable in short mode — a skipped test of this kind restores
exactly the blind spot it closes.

### The drag, and why the shell's was extracted rather than copied

`createDividerDrag` was extracted from `PaneDivider` (`src/web/layout/pane-divider.tsx`) so both
consumers share one implementation. The behaviour is not React's; only the rendering is. The single
difference is `unitsPerPixel`: a shell divider's value is a pixel width and passes `1`, a column divider's
is a percentage of its container and passes `100 / containerWidth`.

It is attached by **delegated DOM listeners**, not a React island: the preview is a
`dangerouslySetInnerHTML` element replaced on every keystroke, `createRoot` appears exactly once in the
app, and there is no island infrastructure. This follows the precedent already in
`rich-editor.tsx:453-511`. All six listeners — `pointerdown`, `pointermove`, `pointerup`,
`pointercancel`, `lostpointercapture`, `keydown` — are on the container rather than on the dividers, and
that includes the move/release pair: pointer capture retargets an event to the capturing element, but
captured events still **bubble** through its ancestors, so delegation loses nothing.

**The wiring must not be a snapshot of the dividers it found.** Measured in a browser: the framework
replaced the preview's `innerHTML` **17 ms after** the attach ran, with the row already present, and
**no React dependency changed** — the rendered HTML was byte-identical. An effect keyed on that HTML did
not re-run, the boundary list went on holding detached dividers, and every `pointerdown` and `keydown`
lookup missed. The symptom was silent in the worst way: the container listener still fired, still
received the right event on the right target, still did not throw, and did nothing. Drag and keyboard
were dead on every page opened from the sidebar and worked only after an Edit → Preview round trip,
which *does* change a dependency. So `attachColumnDividers` watches the container with a
`MutationObserver` on `childList` and rebuilds the list itself; the effect above it is keyed on `mode`
alone and owns only the preview element's identity. `attributes` is deliberately not observed, because
`applyPercent` writes `style` and `aria-valuenow` during a drag and re-scanning on those would discard
the value being dragged.

### The `layoutResizing` document flag is deleted, not implemented

**Decision: deleted.** A shared drag used to set `document.documentElement.dataset.layoutResizing` on
`pointerdown` and clear it on release, from inside `createDividerDrag`, so a column drag set it exactly as
a shell one did. **No stylesheet in `src/` selects it.** Measured across every stylesheet: there is not one
`transition` on a layout property — `width`, `height`, `flex`, `grid-template-columns`, `margin`, `gap` and
the offsets are all transition-free — so the rule the flag existed to enable (`transition: none` during a
drag) would have suppressed nothing, while costing a style recalculation over the whole document on every
drag start.

**It was deleted rather than implemented** because it was simultaneously a live API with no consumer, tested
as though it worked, and recorded here as a pending decision. That combination misleads: a reader of the
tests would conclude the app shell suppresses transitions during a drag, and no reader would notice there
is no rule that does.

**The tests now assert the absence instead**, and they assert it by reading the attribute outright rather
than by diffing a before/after snapshot. That distinction was measured, not assumed: the snapshot form
passed against a build with the flag reinstated, because a flag left set by an earlier test is in the
"before" too and the assertion agreed with the reintroduced code. `documentElement.outerHTML` is no
better — a drag legitimately rewrites the pane's `style.flex` and the divider's `aria-valuenow`, so it
reports the feature working as a failure.

**Reversible, at a cost of roughly six lines and two test edits.** If animated resizing is wanted later,
the correct shape is:

- Scope the rule to the pane classes — the shell's page-tree pane and sidebar, and the Markdown `.rt-cols`
  row — and **not** `* { transition: none !important }`. Transitions are not confined to colour and
  shadow: there are three live `transform` transitions that a document-wide reset would kill, all of them
  affordances a drag is not the subject of — the dashboard card lift (`page-card.module.css`, 150 ms), the
  tree row's chevron rotate (`page-tree.module.css`, 120 ms) and the debug log's row chevron
  (`debug-log-viewer.module.css`, 120 ms). The tab strip already models the right instinct locally:
  `.tabScroller [data-dragging="true"] { transition: none }` suppresses only the element being dragged, and
  the comment there records why the neighbours keep theirs.
- Animate `transform` rather than `width`. `width` animation forces a layout pass on every frame of the
  drag, which is the cost the drag was avoiding; `transform` stays on the compositor.
- Give the flag a second consumer or leave it out. A document-level flag that nothing selects is the defect,
  not the neutral form.

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
