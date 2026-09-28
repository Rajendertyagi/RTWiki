import type { CompileContext, Handle, HtmlExtension } from 'micromark-util-types'

/**
 * ` ```mermaid ` fences in Markdown, as a **placeholder**.
 *
 * ## What this is, and what it is not
 *
 * `mermaid.render()` is asynchronous and micromark's compiler is synchronous, so
 * nothing here may await and nothing here renders. This module recognises the
 * fence, carries the diagram source through the sanitiser intact, and emits
 * markup for a later pass to fill in. Hydration is a separate phase; this file
 * imports no Mermaid configuration and must not grow one.
 *
 * The single source of truth for how Mermaid is configured stays
 * `src/web/features/rich-editor/blocks/mermaid-render.ts`. A second
 * configuration here would let the editor and a Markdown note disagree about
 * `securityLevel`, and that disagreement is a security boundary, not a detail.
 *
 * ## Why the source is element text and never an attribute
 *
 * **Measured, and the consequence is a design rule rather than a workaround.**
 * DOMPurify's `SAFE_FOR_XML` check strips any attribute whose value matches
 * `/((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i`,
 * and it runs **before** the allow-list, so `ADD_ATTR` and `ALLOWED_ATTR` cannot
 * rescue it. Mermaid's arrow syntax is literally `-->`, so
 * `data-chart="A-->B"` loses the attribute entirely, silently. `ADD_ATTR` does
 * not help; the value is checked first. Only `SAFE_FOR_XML: false` would, and
 * turning that off weakens a control that exists to stop mXSS.
 *
 * So the source travels as `<pre>` **text content**:
 *
 * ```html
 * <div class="rt-mermaid"><pre class="rt-mermaid-source">…escaped…</pre></div>
 * ```
 *
 * The dangerous sequence then sits in a text node, which the value-level regex
 * never inspects, and it is re-serialised as `--&gt;` so it cannot re-open
 * markup. `<script type="application/json">` is the shape that looks equivalent
 * and is not: `script` is in RTWiki's `FORBID_TAGS`, and DOMPurify removes the
 * element **with its subtree**, so the source is destroyed rather than carried.
 *
 * ## The token stream this is written against
 *
 * Measured against `micromark@4.0.3` (`dev/lib/constructs.js`, `codeFenced`),
 * a closed ``` ```mermaid ``` fence is 24 events:
 *
 * ```text
 * enter  codeFenced                        exit  codeFenced
 *   enter   codeFencedFence                enter   codeFencedFence
 *     enter/exit codeFencedFenceSequence
 *     enter  codeFencedFenceInfo
 *       enter/exit data                    <- the info string
 *     exit   codeFencedFenceInfo           <- the value is available only here
 *   exit    codeFencedFence
 *   enter/exit lineEnding
 *   enter/exit codeFlowValue               <- one per content line
 *   enter/exit codeFencedFenceSequence     <- the closing fence
 * exit  codeFenced
 * ```
 *
 * Two consequences, both of which are load-bearing:
 *
 * - **The language is known at `exit.codeFencedFenceInfo` and nowhere later.**
 *   It is not a property of `codeFenced`, and there is no token on the fence
 *   itself. So the decision cannot be made at `enter.codeFenced`, which is why
 *   the opening tag is written speculatively and corrected at the end.
 * - **` ```ts [app.ts] {1,3} ` splits its info string.** `codeFencedFenceInfo`
 *   carries only `ts`; the filename and the highlight ranges arrive later as a
 *   separate `codeFencedFenceMeta`, preceded by a `whitespace` token. Detection
 *   therefore reads `codeFencedFenceInfo` alone, and the metadata can never leak
 *   into a diagram source.
 *
 * ## Byte parity for every fence that is not a diagram
 *
 * **The default output is not re-implemented; it is captured.** `enter.codeFenced`
 * opens a buffer, every default handler below it then writes into that buffer
 * exactly as it normally would, and `exit.codeFenced` writes the resumed string
 * straight back out. `<pre><code>`, `class="language-x"`, the escaping of the
 * content and the closing tags are all still micromark's own output.
 *
 * Four handlers are overridden, and the hand-written part of each is small and
 * pinned by `tests/markdown-mermaid.test.ts`, which diffs every untouched fence
 * against stock micromark:
 *
 * | Handler                | Why it is overridden, and how little is rewritten |
 * | ---------------------- | ------------------------------------------------- |
 * | `enter.codeFenced`     | To open the buffer, after `onentercodefenced`'s own leading `lineEndingIfNeeded()` has run against the **enclosing** buffer. |
 * | `exit.codeFencedFenceInfo` | The one moment the info string is readable. Its body is stock's two lines, unchanged. |
 * | `exit.codeFenced`      | The one moment the choice can be made. It runs stock's tail, then resumes. |
 * | — nothing else         | `codeFlowValue`, `lineEnding`, `codeFencedFence`, `codeFencedFenceMeta` and the closing `fence` all keep their default handlers. |
 *
 * The buffering itself has a failure mode worth stating, because it is silent:
 * `enter.codeFenced` **must** call `this.buffer()` and `exit.codeFenced` **must**
 * call `this.resume()`. Push without popping and the buffer stack desynchronises,
 * after which the remainder of the document is written into a buffer nobody ever
 * reads and is dropped without an error. A document that starts with a diagram
 * would lose every paragraph after it. Asserted directly.
 *
 * `this.sliceSerialize(token)` is likewise only valid in an **exit** handler: it
 * dereferences `token.end`, which is not yet resolved on entry.
 */

/**
 * The info string that selects a diagram.
 *
 * **Matched exactly, case-sensitively.** It is the author's own typed token, the
 * same string micromark puts in `class="language-…"`, and RTWiki does not
 * normalise it. ` ```Mermaid ` therefore stays an ordinary code block — a visible
 * `<pre><code class="language-Mermaid">` rather than a diagram that silently
 * does not appear. Asserted, so the boundary is a decision on record rather than
 * an accident.
 */
const MERMAID_INFO = 'mermaid'

/** Class on the placeholder element. Phase B fills this in; this phase only emits it. */
export const MERMAID_CLASS = 'rt-mermaid'

/** Class on the element whose text is the diagram source. */
export const MERMAID_SOURCE_CLASS = 'rt-mermaid-source'

/**
 * Compile-data key holding the fence's info string, or `undefined` when the
 * fence is not a diagram.
 *
 * `CompileData` is micromark's per-render key/value store, so this state is
 * created and destroyed with the render it belongs to. A module-level variable
 * would work too — the read and the write happen inside one fence's event range,
 * and fences cannot nest — but per-render storage is correct by construction
 * rather than by argument, and the interface is augmented below rather than cast
 * away.
 */
const FENCE_INFO = 'rtWikiFenceInfo'

/**
 * Compile-data key holding the exact opening tag written into the fence's own
 * buffer, so the source can be recovered from the resumed HTML by removing it.
 */
const FENCE_OPENING = 'rtWikiFenceOpening'

declare module 'micromark-util-types' {
  interface CompileData {
    /** RTWiki: the info string of the fenced code block being serialised. */
    rtWikiFenceInfo?: string | undefined
    /** RTWiki: the opening tag already written for that block. */
    rtWikiFenceOpening?: string | undefined
  }
}

/**
 * The opening `<code>` tag micromark writes, and the class attribute it adds for
 * a fence that declares a language.
 *
 * Re-declared here only so the source can be recovered from the resumed HTML
 * without slicing at a guessed offset. The two are the values micromark's
 * `onentercodefenced` and `onexitcodefencedfenceinfo` write, and a test asserts
 * the recovered text is exactly the fence content — which fails loudly if they
 * ever stop matching.
 */
const CODE_OPEN = '<pre><code'

/** The closing tag for a code block, written by `onexitflowcode` in stock. */
const CODE_CLOSE = '</code></pre>'

/**
 * micromark's unconditional `lineEnding()`, which `CompileContext` does not
 * expose.
 *
 * Only the *conditional* `lineEndingIfNeeded()` is offered, and its guard cannot
 * be defeated with an empty string: it reads the last **slice** written as
 * `slice ? slice.charCodeAt(slice.length - 1) : codes.eof`, and `''` is falsy,
 * so an empty slice is read as end-of-output and the line ending is skipped.
 *
 * A single NUL can defeat it. micromark's preprocessor maps every NUL in the
 * input to `U+FFFD` (`preprocess.js`, `case codes.nul`), so this character
 * cannot occur anywhere in the tokenised stream — not in a code fence's content,
 * not in an info string, not in a line ending. Writing it therefore forces the
 * guard to fail without contributing anything of its own, and the line ending
 * that comes out is the document's own, produced by micromark, in the document's
 * own style (`\n`, `\r\n` or `\r`). That last point is why this is exact rather
 * than an approximation of the compiler's private `lineEndingStyle`.
 *
 * {@link removeLineEndingSentinel} takes the sentinel back out.
 */
const LINE_ENDING_SENTINEL = ' '

/**
 * Removes the sentinel {@link lineEnding} leaves behind.
 *
 * A no-op when no sentinel was written, and unambiguous when one was, because the
 * sentinel cannot occur in the document.
 */
function removeLineEndingSentinel(html: string): string {
  return html.replace(LINE_ENDING_SENTINEL, '')
}

/** Writes the document's line ending, unconditionally. */
function lineEnding(context: CompileContext): void {
  context.raw(LINE_ENDING_SENTINEL)
  context.lineEndingIfNeeded()
}

/**
 * The line ending at the end of a value, in any of the three forms micromark
 * preserves, or `''` when there is none.
 *
 * micromark's preprocessor keeps `\r\n` as a two-character chunk rather than
 * collapsing it to `\n`, so a document authored on Windows reaches this code with
 * Windows line endings and a `.endsWith('\n')` check would leave a stray `\r`
 * behind. Measured: a `\r\n` document produced a source ending `\r`.
 */
const FINAL_LINE_ENDING = /\r\n$|\r$|\n$/

/**
 * The diagram source, recovered from what the default handlers wrote.
 *
 * The resumed buffer for a diagram fence is, in order: the opening tag, then the
 * content — already HTML-escaped by micromark, which is what makes it safe to
 * place in a text node — then a single line ending that terminates the block
 * rather than belonging to the diagram. That last one is removed, so the `<pre>`
 * holds exactly the lines the author wrote between the fences, with the
 * document's own line endings. A fence with no content lines yields the empty
 * string, not a lone line feed.
 */
function diagramSource(context: CompileContext, html: string): string {
  const opening = context.getData(FENCE_OPENING) ?? CODE_OPEN
  const body = html.startsWith(opening) ? html.slice(opening.length) : html
  const lineEndingAtEnd = body.match(FINAL_LINE_ENDING)
  return lineEndingAtEnd === null ? body : body.slice(0, -lineEndingAtEnd[0].length)
}

/**
 * The placeholder markup for one fence.
 *
 * Assembled as one string and written with `this.tag`, so the sanitiser sees a
 * finished element rather than a half-open one.
 */
function placeholder(source: string): string {
  return `<div class="${MERMAID_CLASS}"><pre class="${MERMAID_SOURCE_CLASS}">${source}</pre></div>`
}

/**
 * `enter.codeFenced`, replacing `onentercodefenced`.
 *
 * The first statement is micromark's own, and it is **deliberately before**
 * `buffer()`: in stock it writes into the enclosing buffer, and opening the fence
 * buffer first would make it a no-op (an empty buffer has nothing to separate
 * from), moving the line ending from before the fence to inside it.
 *
 * `<pre><code` is still written even for a diagram, because the language is not
 * known until the info string has been read. It is removed again in
 * `exit.codeFenced`, where the buffer is resumed and either kept or discarded.
 */
const onenterCodeFenced: Handle = function () {
  this.lineEndingIfNeeded()
  this.buffer()
  this.tag(CODE_OPEN)
  this.setData('fencesCount', 0)
}

/**
 * `exit.codeFencedFenceInfo`, replacing `onexitcodefencedfenceinfo`.
 *
 * Stock's two lines, in stock's order, with stock's string: the value is the
 * **escaped** text the default handlers produced, so the class attribute is
 * byte-identical to what micromark would have written. Only the language test
 * and the record of the opening tag are added.
 */
const onexitCodeFencedFenceInfo: Handle = function () {
  const value = this.resume()
  const classAttribute = ` class="language-${value}"`
  this.tag(classAttribute)
  if (value === MERMAID_INFO) {
    this.setData(FENCE_INFO, value)
    this.setData(FENCE_OPENING, `${CODE_OPEN}${classAttribute}>`)
  }
}

/**
 * `exit.codeFenced`, replacing `onexitflowcode`.
 *
 * The first block is micromark's tail, transcribed: the extra line ending for an
 * unclosed fence inside a container, the line ending after content, and
 * `</code></pre>`. It is written into the fence's own buffer, so it is captured
 * by the `resume()` below and re-emitted as part of the same string. A diagram
 * skips it, because there is no `<code>` element to close.
 *
 * The buffer is then resumed **exactly once**, on both paths. A `resume()`
 * without a matching `buffer()` throws; a `buffer()` without a matching
 * `resume()` leaves the stack one deep and silently discards the rest of the
 * document.
 */
const onexitCodeFenced: Handle = function () {
  const count = this.getData('fencesCount')
  const isDiagram = this.getData(FENCE_INFO) === MERMAID_INFO

  if (!isDiagram) {
    // `onexitflowcode`, in order, against the same key/value store.
    if (
      count !== undefined &&
      count < 2 &&
      this.getData('tightStack').length > 0 &&
      !this.getData('lastWasTag')
    ) {
      lineEnding(this)
    }
    if (this.getData('flowCodeSeenData')) this.lineEndingIfNeeded()
    this.tag(CODE_CLOSE)
  }

  const html = removeLineEndingSentinel(this.resume())

  // `tag` rather than `raw`: it respects the image alt-text suppression exactly
  // as stock's `tag('</code></pre>')` did, and it records `lastWasTag`, which the
  // next fenced block reads.
  this.tag(isDiagram ? placeholder(diagramSource(this, html)) : html)

  // The tail that belongs to the *enclosing* buffer, then the three
  // `setData(key)` calls, which delete rather than assign.
  if (count !== undefined && count < 2) this.lineEndingIfNeeded()
  this.setData('flowCodeSeenData')
  this.setData('fencesCount')
  this.setData('slurpOneLineEnding')
  this.setData(FENCE_INFO)
  this.setData(FENCE_OPENING)
}

/**
 * The serialiser half. There is no syntax half.
 *
 * Detection is done on the tokens micromark's own `codeFenced` construct already
 * produces, so nothing is added to the grammar: a fence that is not a diagram
 * takes exactly the path it took before, which is what the byte-parity table in
 * {@link mermaidHtml} measures.
 */
export function mermaidHtml(): HtmlExtension {
  return {
    enter: { codeFenced: onenterCodeFenced },
    exit: {
      codeFencedFenceInfo: onexitCodeFencedFenceInfo,
      codeFenced: onexitCodeFenced
    }
  }
}
