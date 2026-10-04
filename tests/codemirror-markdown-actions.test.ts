import { describe, expect, it } from 'bun:test'
import {
  applyBlockPrefix,
  buildCallout,
  buildInlineMath,
  buildLink,
  buildTable,
  isWholeLineSelection,
  toggleCodeFence,
  wrapInline,
  wrapInlinePerLine
} from '../src/web/features/workspace/codemirror-markdown-actions.js'

describe('whole-line detection', () => {
  it('accepts a selection spanning whole lines', () => {
    expect(
      isWholeLineSelection({ fromLine: 1, toLine: 3, fromColumn: 0, toColumn: 0, toLineLength: 0 })
    ).toBe(true)
  })

  it('rejects a selection that starts mid-line', () => {
    expect(
      isWholeLineSelection({ fromLine: 1, toLine: 1, fromColumn: 4, toColumn: 0, toLineLength: 0 })
    ).toBe(false)
  })

  it('rejects a selection that ends mid-line', () => {
    expect(
      isWholeLineSelection({ fromLine: 1, toLine: 1, fromColumn: 0, toColumn: 7, toLineLength: 20 })
    ).toBe(false)
  })

  /*
   * The bug this file did not catch until a browser test did.
   *
   * A select-all over a one-line document puts the caret at the last character,
   * so the end column is the line's *length*, not 0. The original check was
   * `toColumn === 0`, which reported `5 === 0` for `Title` and rejected it — so
   * every block control (heading, list, quote, table) was disabled while the
   * inline marks worked. The hand-written selections above all ended at column 0,
   * which is exactly why they passed.
   */
  it('accepts a select-all, whose end column is the line length', () => {
    expect(
      isWholeLineSelection({ fromLine: 1, toLine: 1, fromColumn: 0, toColumn: 5, toLineLength: 5 })
    ).toBe(true)
  })

  it('accepts an end column past the line length, as CodeMirror reports one', () => {
    // Selecting through the newline puts the end on the next line's start, which
    // is one past this line's text.
    expect(
      isWholeLineSelection({ fromLine: 1, toLine: 1, fromColumn: 0, toColumn: 6, toLineLength: 5 })
    ).toBe(true)
  })

  it('still rejects an end column short of the line length', () => {
    expect(
      isWholeLineSelection({ fromLine: 1, toLine: 1, fromColumn: 0, toColumn: 4, toLineLength: 5 })
    ).toBe(false)
  })
})

describe('block prefixes', () => {
  it('adds a heading marker to every selected line', () => {
    expect(applyBlockPrefix(['One', 'Two'], '## ', false)).toEqual(['## One', '## Two'])
  })

  it('removes the marker when already active, so it toggles', () => {
    expect(applyBlockPrefix(['## One', '## Two'], '## ', true)).toEqual(['One', 'Two'])
  })

  it('does not stack two headings', () => {
    expect(applyBlockPrefix(['## One'], '## ', true)).toEqual(['One'])
    expect(applyBlockPrefix(['### One'], '## ', true)).toEqual(['One'])
  })

  it('preserves indentation, so list continuation survives', () => {
    expect(applyBlockPrefix(['  nested'], '> ', false)).toEqual(['  > nested'])
  })

  it('refuses to prefix a fence line, so the block is not broken', () => {
    // Prefixing a fence line turns the fence into content and the block stops being
    // code. Content lines inside it are ordinary text and ARE prefixed - a reader who
    // selects a block and presses H1 means "make these lines headings".
    expect(applyBlockPrefix(['```js', 'const a = 1', '```'], '# ', false)).toEqual([
      '```js',
      '# const a = 1',
      '```'
    ])
  })

  it('round-trips: apply then remove is the identity', () => {
    const original = ['Alpha', '  Beta', 'Gamma']
    const applied = applyBlockPrefix(original, '- ', false)
    expect(applyBlockPrefix(applied, '- ', true)).toEqual(original)
  })

  it('handles a numbered list marker, removing it on toggle', () => {
    expect(applyBlockPrefix(['1. first', '2. second'], '1. ', true)).toEqual(['first', 'second'])
  })
})

describe('inline wrapping', () => {
  it('wraps a selection in bold', () => {
    expect(wrapInline('text', '**')).toBe('**text**')
  })

  it('unwraps when already wrapped, so it toggles', () => {
    expect(wrapInline('**text**', '**')).toBe('text')
  })

  it('unwraps italic', () => {
    expect(wrapInline('*text*', '*')).toBe('text')
  })

  it('wraps inline code', () => {
    expect(wrapInline('x', '`')).toBe('`x`')
  })

  it('wraps strikethrough per line', () => {
    expect(wrapInlinePerLine('one\ntwo', '~~')).toBe('~~one~~\n~~two~~')
  })

  it('leaves a blank line untouched when wrapping per line', () => {
    // Wrapping an empty line would produce `~~~~`, which Markdown reads as a fence.
    expect(wrapInlinePerLine('one\n\ntwo', '~~')).toBe('~~one~~\n\n~~two~~')
  })

  it('round-trips per line', () => {
    const original = 'one\ntwo'
    expect(wrapInlinePerLine(wrapInlinePerLine(original, '~~'), '~~')).toBe(original)
  })
})

describe('code fences', () => {
  it('fences selected lines, stripping their indentation', () => {
    expect(toggleCodeFence(['const a = 1', 'const b = 2'])).toEqual([
      '```',
      'const a = 1',
      'const b = 2',
      '```'
    ])
  })

  it('fences with a language', () => {
    expect(toggleCodeFence(['x'], 'js')[0]).toBe('```js')
  })

  it('unfences an existing block, de-indenting the body', () => {
    expect(toggleCodeFence(['```js', '    const a = 1', '```'])).toEqual(['const a = 1'])
  })

  it('round-trips', () => {
    const original = ['const a = 1', 'const b = 2']
    expect(toggleCodeFence(toggleCodeFence(original))).toEqual(original)
  })
})

describe('insertions', () => {
  it('builds a GFM table with a header and a rule row', () => {
    expect(buildTable(['Name', 'Size'])).toEqual(['| Name | Size |', '| --- | --- |', '|   |   |'])
  })

  it('builds a callout in the syntax the parser actually accepts', () => {
    // Measured: `:::note Title` is parsed as inline text. The title has to be a bold
    // first line inside the block.
    const lines = buildCallout('warning', 'Careful', 'Body.')
    expect(lines).toContain(':::warning')
    expect(lines).toContain('**Careful**')
    expect(lines[lines.length - 2]).toBe(':::')
  })

  it('never puts the title after the directive name', () => {
    const lines = buildCallout('note', 'Title')
    expect(
      lines.some((line) => /^:::note\s+\S/.test(line)),
      'must not be `:::note Title`'
    ).toBe(false)
  })

  it('emits inline maths with adjacency so $$ is not mistaken for it', () => {
    const math = buildInlineMath()
    expect(math.startsWith('$x')).toBe(true)
    expect(math.endsWith('$')).toBe(true)
  })
})

describe('links', () => {
  it('wraps a selected label in a link', () => {
    expect(buildLink('RTWiki', 'https://rtwiki.dev')).toBe('[RTWiki](https://rtwiki.dev)')
  })

  it('inserts an empty link when there is no selection', () => {
    expect(buildLink('', 'https://rtwiki.dev')).toBe('[](https://rtwiki.dev)')
  })

  it('leaves the target empty when none was typed', () => {
    expect(buildLink('Label', '   ')).toBe('[Label]()')
    expect(buildLink('', '')).toBe('[]()')
  })
})
