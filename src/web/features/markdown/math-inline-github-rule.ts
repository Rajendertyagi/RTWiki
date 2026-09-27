import { codes, types } from 'micromark-util-symbol'
import type {
  Code,
  Construct,
  Effects,
  State,
  TokenizeContext,
  Tokenizer
} from 'micromark-util-types'

/**
 * Inline `$…$` maths, delimited by GitHub's adjacency rule.
 *
 * ## Why this exists
 *
 * `micromark-extension-math@3.1.0` decides inline maths by **marker count**: with
 * `singleDollarTextMath` on (the default) a single `$` opens maths and *anything*
 * may sit between the delimiters. It has no notion of adjacency, and its only option
 * is a boolean that governs marker count. So it cannot express GitHub's rule at all.
 *
 * The consequence is a false positive on ordinary prose, measured:
 *
 * | Source                          | Package's behaviour |
 * | ------------------------------- | -------------------- |
 * | `Pay $5 or $10 today.`          | maths                |
 * | `Between $3 and $4.`            | maths                |
 * | `It cost $20,000 and $30,000 won.` | maths             |
 *
 * Two dollar amounts in one sentence became an equation. That is a **defect**, not a
 * trade-off: the alternative setting removes inline maths entirely, so the package
 * offers no correct option. This construct is that option.
 *
 * ## The rule implemented
 *
 * GitHub's documented inline rule, which is three adjacency conditions:
 *
 * 1. the opening `$` is followed by a **non-whitespace** character;
 * 2. the closing `$` is preceded by a **non-whitespace** character;
 * 3. the closing `$` is **not** followed immediately by a **digit**.
 *
 * A construct that fails any of them is not maths, and the `$` is ordinary text.
 * A construct that never finds a valid closer is ordinary text too, which is what
 * makes `Only $100.` safe: the opener is legal, but no closer ever qualifies.
 *
 * ## What was kept, and why
 *
 * The `previous` guard is carried over unchanged: a `$` immediately after another `$`
 * does not open text maths (that is the `flow` construct's job), and a `$` after a
 * backslash escape *does*, so `\$x$` still works. That behaviour is correct in the
 * package and re-implementing it differently would be a regression.
 *
 * Only the delimiter decision differs. Multi-character runs are not handled at all:
 * see {@link mathTextGithubRule} for why that is a deliberate simplification.
 *
 * ## Attribution and licence
 *
 * The state-machine *shape* — `start` → `sequenceOpen` → `between` → `data` →
 * `sequenceClose`, and the `effects.enter`/`consume`/`exit` protocol — follows
 * **`micromark-extension-math`**, which is MIT-licensed, by Titus Wormer
 * (<https://github.com/micromark/micromark-extension-math>). The token names
 * (`mathText`, `mathTextSequence`, `mathTextData`) are that package's, because the
 * `mathHtml` renderer in the same pipeline matches on them and they are its public
 * serialisation contract.
 *
 * The delimiter *logic* is ours and is not copied from it. Two pieces of the package
 * are carried over deliberately, because they are correct and re-deriving them would
 * mean re-deriving them wrongly: the marker-run matching (`sizeOpen`/`size`, which
 * keeps `$$…$$` on one line working) and the `previous` guard (which keeps `\$x$`
 * working). Neither touches the adjacency decision, which is entirely ours.
 *
 * The package's `resolve` function is **not** reproduced. It exists to pair up runs of
 * different marker sizes *across* a document; this construct resolves every candidate
 * within a single construct invocation, so there is nothing for it to pair.
 */
export function mathTextGithubRule(): Construct {
  return {
    tokenize: tokenizeMathText,
    previous,
    name: 'mathText'
  }

  /**
   * @this {TokenizeContext}
   * @type {Tokenizer}
   */
  function tokenizeMathText(effects: Effects, ok: State, nok: State): State {
    /**
     * True while the most recent non-marker character was whitespace.
     *
     * Condition 2 is "the closing `$` is preceded by a non-whitespace character", and
     * a character-at-a-time state machine cannot look backwards, so adjacency is
     * tracked as it is consumed. Set when whitespace is consumed, cleared by any
     * other data character.
     */
    let precededByWhitespace = false

    /**
     * How many `$` opened the expression, and how many closed it.
     *
     * Runs are matched rather than ignored, and that is not optional. The package
     * supports `$$…$$` on one line as inline maths, and without run matching this
     * construct opened maths on an *empty* `$$` — silently losing the fraction
     * inside. Matching keeps the one-line form working while the adjacency conditions
     * still decide whether the whole thing is maths at all.
     */
    let sizeOpen = 0
    let size = 0

    /**
     * The token being read as the closing run, so a run-size mismatch can re-type it
     * as data and keep scanning — the package's approach, and the only way a
     * mismatched run does not discard the text before it.
     */
    let closingToken: { type: string } | undefined

    /**
     * @type {State}
     *   Start of maths, at the first `$`.
     */
    function start(code: Code): State | undefined {
      effects.enter('mathText')
      effects.enter('mathTextSequence')
      effects.consume(code)
      sizeOpen = 1
      return sequenceOpen
    }

    /**
     * @type {State}
     *   Just after the opening run. Condition 1: the next character must not be
     *   whitespace, and there must be one at all.
     */
    function sequenceOpen(code: Code): State | undefined {
      if (code === codes.dollarSign) {
        effects.consume(code)
        sizeOpen++
        return sequenceOpen
      }
      if (isWhitespaceOrEnd(code)) {
        // `$ x$` and a bare trailing `$` are not maths. `nok` rewinds, so the `$` is
        // re-read as ordinary text by whatever construct handles it.
        return nok(code)
      }
      effects.exit('mathTextSequence')
      return between(code)
    }

    /**
     * @type {State}
     *   Inside the expression, between runs of data.
     */
    function between(code: Code): State | undefined {
      if (code === codes.eof) return nok(code)

      if (code === codes.dollarSign) {
        if (precededByWhitespace) {
          // Condition 2. `Pay $5 or $10` lands here on the second `$`. It is text,
          // the scan continues, and with no other candidate the construct fails at the
          // end of the paragraph — which is what makes the sentence text.
          effects.enter('mathTextData')
          effects.consume(code)
          effects.exit('mathTextData')
          return between
        }
        closingToken = effects.enter('mathTextSequence')
        size = 0
        return sequenceClose
      }

      if (isWhitespace(code)) {
        effects.enter('space')
        effects.consume(code)
        effects.exit('space')
        precededByWhitespace = true
        return between
      }

      if (isLineEnding(code)) {
        effects.enter(types.lineEnding)
        effects.consume(code)
        effects.exit(types.lineEnding)
        precededByWhitespace = true
        return between
      }

      effects.enter('mathTextData')
      return data(code)
    }

    /**
     * @type {State}
     *   Inside a run of expression characters.
     */
    function data(code: Code): State | undefined {
      if (
        code === codes.eof ||
        isWhitespace(code) ||
        code === codes.dollarSign ||
        isLineEnding(code)
      ) {
        effects.exit('mathTextData')
        return between(code)
      }
      effects.consume(code)
      precededByWhitespace = false
      return data
    }

    /**
     * @type {State}
     *   At a `$` in the closing run. The run is consumed as it is read; whether it is
     *   a valid closer at all is decided in {@link afterClose}.
     *
     * Consuming before the verdict is safe because `nok` rewinds the entire attempt,
     * discarding every effect. It is also necessary: leaving a `$` unconsumed closes
     * `mathTextSequence` around nothing, and the document then fails to postprocess
     * with a message about `construct.tokenize` rather than about this file.
     */
    function sequenceClose(code: Code): State | undefined {
      effects.consume(code)
      size++
      return afterClose
    }

    /**
     * @type {State}
     *   The run has ended. The run-size check, then condition 3.
     *
     * The character after the closing run is not available until the tokenizer is
     * handed it, which is why the verdict is deferred here rather than taken in
     * {@link sequenceClose}.
     */
    function afterClose(code: Code): State | undefined {
      if (code === codes.dollarSign) {
        effects.consume(code)
        size++
        return afterClose
      }

      // A closing run of a different length than the opening one is not a closer. The
      // run becomes data and the scan continues, so nothing before it is lost — which
      // is what keeps `$a$$b$` from discarding the text it has already read.
      //
      // Handing back to `between`, not to `data`: the re-typed run has already been
      // popped by the `exit` above, and `data` would exit a `mathTextData` that was
      // never entered — popping one token too many and corrupting the event stack.
      if (size !== sizeOpen) {
        if (closingToken) closingToken.type = 'mathTextData'
        effects.exit('mathTextData')
        return between(code)
      }

      // Condition 3: the closing `$` must not be followed by a digit.
      if (isDigit(code)) return nok(code)

      effects.exit('mathTextSequence')
      effects.exit('mathText')
      return ok(code)
    }

    // The state machine begins here. Omitting this return is silent in a way worth
    // recording: micromark calls `tokenize(...)` and immediately invokes the result,
    // so a missing return makes the construct throw deep inside `create-tokenizer`
    // with a message about `construct.tokenize` rather than about this file.
    return start
  }
}

/**
 * Carried over from `micromark-extension-math`, unchanged.
 *
 * A `$` directly after another `$` does not open inline maths — that is what the
 * `flow` construct is for — and a `$` directly after a backslash escape *does*, so
 * `\$x$` renders as a literal `$` followed by maths.
 *
 * @this {TokenizeContext}
 */
function previous(this: TokenizeContext, code: Code): boolean {
  return (
    code !== codes.dollarSign ||
    this.events[this.events.length - 1][1].type === types.characterEscape
  )
}

/** Whether a code is a space or a tab. */
function isWhitespace(code: Code): boolean {
  return code === codes.space || code === codes.horizontalTab
}

/** Whether a code ends a line. */
function isLineEnding(code: Code): boolean {
  return code === codes.carriageReturnLineFeed || code === codes.lineFeed
}

/**
 * Whether a code ends the run, for the purpose of "must be followed by something".
 *
 * Line endings count. A `$` immediately before a line break has nothing after it on
 * that line, so treating it as a valid opener would let a sentence ending in `$` open
 * maths that swallows the rest of the paragraph.
 */
function isWhitespaceOrEnd(code: Code): boolean {
  return code === codes.eof || isWhitespace(code) || isLineEnding(code)
}

/** Whether a code is an ASCII digit, per condition 3. */
function isDigit(code: Code): boolean {
  // `null` is end-of-input and is not a digit; the guard is what makes that explicit
  // rather than relying on `null >= 48` being false, which is true by accident.
  return code !== null && code >= codes.digit0 && code <= codes.digit9
}
