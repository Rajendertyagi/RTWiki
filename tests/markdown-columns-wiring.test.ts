import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'
import { sharedDom, sharedWindow } from './utils/dom-harness.js'

/**
 * The divider wiring, against the **real** rendered output.
 *
 * ## Why this file exists
 *
 * `markdown-columns-divider.test.ts` builds its DOM from a **hand-written
 * fixture** — the markup the render path is believed to produce. That is how the
 * feature reached a browser with dead drag and keyboard handlers: the fixture was
 * faithful, so 22 tests passed, and nothing had ever run the wiring against the
 * output of `renderMarkdown` itself.
 *
 * If the real markup differs from the fixture in any way the wiring depends on —
 * an extra wrapper, a renamed class, a missing attribute, a nested row — the
 * wiring finds nothing, attaches nothing, and **every** interaction silently does
 * nothing. That is precisely the shape of "the pane did not move".
 *
 * So this file closes the gap: the container is filled from the real
 * `renderMarkdown` output, and the same keyboard and pointer sequences are
 * replayed against it. It is the closest a unit test gets to the browser, and it
 * is the check the hand-written fixture made impossible.
 */

const TWO_PANES = ':::columns{left=40}\nLeft pane\n\n***\n\nRight pane\n:::'

/** Four children at 25 each, so a middle boundary can be driven. */
const FOUR_CHILDREN = [
  '::::columns',
  ':::column{width=25}',
  'One',
  ':::',
  '',
  ':::column{width=25}',
  'Two',
  ':::',
  '',
  ':::column{width=25}',
  'Three',
  ':::',
  '',
  ':::column{width=25}',
  'Four',
  ':::',
  '::::'
].join('\n')

let renderMarkdown: (source: string) => string
let attach: (el: HTMLElement) => () => void

beforeAll(async () => {
  sharedDom()
  const render = await import('../src/web/features/markdown/markdown-render.js')
  renderMarkdown = render.renderMarkdown
  const wiring = await import('../src/web/features/markdown/markdown-columns-divider.js')
  attach = wiring.attachColumnDividers
})

beforeEach(() => {
  sharedDom().window.document.body.innerHTML = ''
})

afterEach(() => {
  sharedDom().window.document.body.innerHTML = ''
})

interface Fixture {
  /** The element whose `innerHTML` holds the rendered Markdown. */
  container: HTMLElement
  root: HTMLElement
  panes: HTMLElement[]
  dividers: HTMLElement[]
}

/**
 * Renders `source`, puts the result in a container, and wires it — exactly the
 * order `markdown-workspace.tsx` performs: render, inject, then attach.
 */
function mount(source: string, containerWidth = 800): Fixture {
  const document = sharedDom().window.document
  const container = document.createElement('div')
  container.className = 'previewPane'
  container.setAttribute('data-testid', 'markdown-rendered')
  container.innerHTML = renderMarkdown(source)
  document.body.append(container)
  const root = container.querySelector('.rt-cols') as HTMLElement
  // jsdom has no layout, so the measured width is set explicitly. The wiring
  // converts pixels to a percent of it.
  Object.defineProperty(root, 'clientWidth', { value: containerWidth, configurable: true })
  attach(container)
  return {
    container,
    root,
    panes: [...container.querySelectorAll<HTMLElement>('.rt-cols__pane')],
    dividers: [...container.querySelectorAll<HTMLElement>('.rt-cols__divider')]
  }
}

function key(k: string): KeyboardEvent {
  return new (sharedWindow() as Window & typeof globalThis).KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: k
  })
}

function pointer(
  type: string,
  init: { clientX: number; button?: number; pointerId?: number }
): PointerEvent {
  const event = new (sharedWindow() as Window & typeof globalThis).MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    button: init.button ?? 0
  })
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 })
  return event as unknown as PointerEvent
}

/** jsdom implements no pointer capture, so every divider gets a stub. */
function stubCapture(elements: HTMLElement[]): void {
  for (const element of elements) {
    element.setPointerCapture = (): void => undefined
  }
}

/**
 * The grow factor on a pane, as the wiring reads and writes it.
 *
 * The **custom property**, because the `flex` shorthand that consumes it is a
 * stylesheet rule in `markdown-columns.css` — see
 * `markdown-columns-styles.test.ts` for the assertion that the rule ships.
 * Read through `getPropertyValue`, because `setProperty` re-serialises the
 * attribute and the attribute is not what the wiring touches.
 */
function flexOf(pane: HTMLElement | null | undefined): string {
  return pane?.style.getPropertyValue('--rt-cols-pane-flex') ?? ''
}

/**
 * Gives the container's current row a measured width.
 *
 * jsdom has no layout, so `clientWidth` is 0 and the wiring's `unitsPerPixel`
 * falls back to 100 — a drag of 80px would then clamp the value to 99 instead of
 * moving it to 50.
 */
function measureRow(container: HTMLElement, width = 800): void {
  const row = container.querySelector<HTMLElement>('.rt-cols')
  if (row === null) return
  Object.defineProperty(row, 'clientWidth', { value: width, configurable: true })
}

/** Waits for a `MutationObserver` callback to have been delivered. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Renders `source` into a detached container and returns its row element. */
function rootOf(source: string): HTMLElement | null {
  const container = sharedDom().window.document.createElement('div')
  container.innerHTML = renderMarkdown(source)
  sharedDom().window.document.body.append(container)
  return container.querySelector('.rt-cols')
}

describe('the browser spec seed for the unknown directive, verified here', () => {
  /**
   * A browser failure that turned out to be the spec's, not the product's.
   *
   * The browser test seeds an unclaimed name (`:::notice`) with `be careful` and then asserts on
   * `.rt-unknown-directive strong`. **`be careful` has no `**` markers**, so it
   * compiles to `<p>be careful</p>` and there is no `<strong>` element anywhere in
   * the document. The locator can never match, in any browser, for any build.
   *
   * Asserted here so the diagnosis is a fact in the suite rather than a claim in
   * a report — and so a future edit that drops the asterisks again fails here,
   * in a place that explains why.
   */
  it('renders the seeded text as a paragraph, with no <strong> to find', () => {
    const document = sharedDom().window.document
    const container = document.createElement('div')
    container.innerHTML = renderMarkdown(
      'before paragraph\n\n:::notice\nbe careful\n\nafter paragraph\n'
    )
    document.body.append(container)

    // The content-loss property the browser test is actually for: the paragraph
    // after an unclaimed, unclosed directive survives.
    expect(container.textContent).toContain('before paragraph')
    expect(container.textContent, 'the paragraph after must survive').toContain('after paragraph')
    // The unknown directive is surfaced, with its name.
    const unknown = container.querySelector('.rt-unknown-directive')
    expect(unknown, 'an unclaimed directive must be visible').not.toBeNull()
    expect(unknown?.textContent).toContain('notice')
    expect(unknown?.textContent).toContain('be careful')
    // And there is no <strong>, because the seed has no emphasis markers. This
    // is the line that makes the browser locator's failure a diagnosis.
    expect(container.querySelector('.rt-unknown-directive strong'), 'the seed has no **').toBeNull()
    // The first paragraph inside is the visible name; the second is the body.
    const paragraphs = [...(unknown?.querySelectorAll('p') ?? [])]
    expect(paragraphs[0]?.className).toBe('rt-unknown-directive__name')
    expect(paragraphs[0]?.textContent).toBe(':::notice')
    expect(paragraphs[1]?.textContent, 'the body renders as a paragraph').toBe('be careful')
  })

  it('does render <strong> when the seed has the markers, which is the intent', () => {
    const document = sharedDom().window.document
    const container = document.createElement('div')
    container.innerHTML = renderMarkdown(
      'before paragraph\n\n:::notice\n**be careful**\n\nafter paragraph\n'
    )
    document.body.append(container)
    expect(container.querySelector('.rt-unknown-directive strong')?.textContent).toBe('be careful')
    expect(container.textContent).toContain('after paragraph')
  })
})

describe('a child with no width is not a rejected width', () => {
  /**
   * Found in a browser, on a row whose widths were all fine.
   *
   * A child that declares no width emits `data-width=""`, and the parent re-read
   * it through the same grammar as a declared value. An empty string is not a
   * whole number, so the row came out `data-width-rejected="true"` — a false
   * alarm on a perfectly valid `20 / 30 / undeclared` row, and one that would
   * mislead anything reading the attribute. An undeclared width is an equal
   * share, not a typo.
   */
  const MIXED = [
    '::::columns',
    ':::column{width=20}',
    'Pane 1',
    ':::',
    '',
    ':::column{width=30}',
    'Pane 2',
    ':::',
    '',
    ':::column',
    'Pane 3',
    ':::',
    '::::'
  ].join('\n')

  it('leaves the row unflagged when every declared width is valid', () => {
    const root = rootOf(MIXED)
    expect(root, 'a three-child row must render').not.toBeNull()
    expect(root?.hasAttribute('data-width-rejected'), 'a valid width is not a correction').toBe(
      false
    )
    // The shares are still what the author asked for.
    expect(
      [...(root?.querySelectorAll('.rt-cols__pane') ?? [])].map((p) => p.getAttribute('data-width'))
    ).toEqual(['20', '30', '50'])
  })

  it('still flags the row when a declared width really is invalid', () => {
    const root = rootOf(MIXED.replace('width=30', 'width="a-->b"'))
    expect(root?.hasAttribute('data-width-rejected'), 'a real rejection is still reported').toBe(
      true
    )
  })

  it('flags the row when every child declares a width, none of them invalid', () => {
    const root = rootOf(MIXED.replace(':::column\n', ':::column{width=50}\n'))
    expect(root?.hasAttribute('data-width-rejected'), 'no false alarm').toBe(false)
  })
})

describe('the wiring is attached to the real rendered output', () => {
  it('finds the panes and the divider the render path actually emits', () => {
    // If this fails, the wiring found nothing and every interaction below is
    // vacuous — which is the failure mode this file exists to catch.
    const fixture = mount(TWO_PANES)
    expect(fixture.root, 'a row must exist').not.toBeNull()
    expect(fixture.panes, 'two panes must exist').toHaveLength(2)
    expect(fixture.dividers, 'one divider must exist').toHaveLength(1)
  })

  it('finds every boundary of a four-child row', () => {
    const fixture = mount(FOUR_CHILDREN)
    expect(fixture.panes).toHaveLength(4)
    expect(fixture.dividers, 'a row of four has three boundaries').toHaveLength(3)
  })

  it('moves a boundary on ArrowRight, from the real markup', () => {
    const fixture = mount(TWO_PANES)
    stubCapture(fixture.dividers)
    const divider = fixture.dividers[0] as HTMLElement
    expect(divider.getAttribute('aria-valuenow'), 'the authored width is announced').toBe('40')

    divider.dispatchEvent(key('ArrowRight'))

    // The step is the shared `LAYOUT.dividerStepWidth`, 20 points.
    expect(divider.getAttribute('aria-valuenow'), 'the key must move the boundary').toBe('60')
    expect(flexOf(fixture.panes[0])).toBe('60')
  })

  it('moves each boundary of a four-child row independently', () => {
    const fixture = mount(FOUR_CHILDREN)
    stubCapture(fixture.dividers)
    const second = fixture.dividers[1] as HTMLElement
    expect(second.getAttribute('aria-valuenow')).toBe('25')

    second.dispatchEvent(key('ArrowRight'))

    expect(second.getAttribute('aria-valuenow')).toBe('45')
    // The pane to its left grew; the one before it did not.
    expect(flexOf(fixture.panes[1])).toBe('45')
    expect(flexOf(fixture.panes[0]), 'an untouched pane keeps its width').toBe('25')
    // And the first boundary is untouched.
    expect(fixture.dividers[0]?.getAttribute('aria-valuenow')).toBe('25')
  })

  it('drags a boundary with the real markup and a real pointer sequence', () => {
    const fixture = mount(TWO_PANES)
    stubCapture(fixture.dividers)
    const divider = fixture.dividers[0] as HTMLElement
    const left = fixture.panes[0] as HTMLElement

    divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    // 80px of an 800px container is 10 points.
    divider.dispatchEvent(pointer('pointermove', { clientX: 80, pointerId: 1 }))
    divider.dispatchEvent(pointer('pointerup', { clientX: 80, pointerId: 1 }))

    expect(divider.getAttribute('aria-valuenow'), 'the drag must move the boundary').toBe('50')
    expect(flexOf(left)).toBe('50')
  })

  it('gives the divider a hit area wide enough to press', async () => {
    // A `div` with no width is a zero-size target, and a press at its centre
    // lands on the pane beside it instead — which is exactly the symptom the
    // browser reported. jsdom computes no layout, so this asserts the width is
    // *declared* in the stylesheet that ships, by the published layout token.
    const sheet = await Bun.file(
      resolve(import.meta.dir, '..', 'src', 'web', 'features', 'markdown', 'markdown-columns.css')
    ).text()
    expect(sheet, 'the divider must declare a width').toMatch(
      /\.rt-cols__divider\s*\{[^}]*width:\s*var\(--rtwiki-divider-hit-width/
    )
  })

  it('writes nothing to the document during a drag', () => {
    const fixture = mount(TWO_PANES)
    stubCapture(fixture.dividers)
    const divider = fixture.dividers[0] as HTMLElement
    const root = sharedDom().window.document.documentElement
    // The `data-*` attributes on `<html>`, asserted by **absence** rather than
    // as a before/after snapshot. A snapshot is order-dependent: a flag left set
    // by an earlier test is in the "before" too, so it would agree with a
    // reintroduced flag and pass. `outerHTML` is no better — a drag legitimately
    // rewrites the pane's `style` and the divider's `aria-valuenow`, so it
    // would report the feature working as a failure.
    const documentDataAttrs = (): string[] =>
      root.getAttributeNames().filter((name) => name.startsWith('data-'))

    divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    // The `layoutResizing` document flag that used to be asserted here was
    // deleted, not implemented: no stylesheet in `src/` selects it, and no
    // layout property carries a transition anywhere, so a `transition: none`
    // rule keyed on it would have suppressed nothing while costing a style
    // recalculation over the whole document. The reversible alternative is
    // recorded in ADR-017.
    //
    // What is left is the claim worth pinning: a drag is confined to the
    // dividers' own attributes, which is what a real rendered drag should do.
    expect(documentDataAttrs(), 'a drag must not flag the document').toEqual([])
    divider.dispatchEvent(pointer('pointerup', { clientX: 0, pointerId: 1 }))
    expect(documentDataAttrs(), 'and must leave no document flag behind').toEqual([])
  })

  it('keeps dragging when the move arrives on a descendant, not the divider', () => {
    /**
     * The browser-measured defect, as a unit test.
     *
     * A drag only works if the move events reach the code that drives it. The
     * first design bound `pointermove` to each divider, which means a move over
     * anything else — the pane, the text, the preview — reached nobody. With
     * `setPointerCapture` in effect that is survivable, because capture retargets
     * every move to the divider; without it, or in the window before a
     * re-attach, the drag moved nothing at all, and a browser showed the moves
     * landing on a `<p>` in the right pane instead.
     *
     * Delegating the move/release pair on the container fixes it for the reason
     * that matters: captured events still **bubble** from the capture target
     * through its ancestors, so the container sees them either way.
     */
    const fixture = mount(TWO_PANES)
    stubCapture(fixture.dividers)
    const divider = fixture.dividers[0] as HTMLElement
    const pane = fixture.panes[0] as HTMLElement

    divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    // The move is dispatched on a **descendant of the container**, not the
    // divider — which is what the browser observed.
    pane.dispatchEvent(pointer('pointermove', { clientX: 80, pointerId: 1 }))

    expect(
      divider.getAttribute('aria-valuenow'),
      'a move over the pane must still drive the drag'
    ).toBe('50')
    expect(flexOf(fixture.panes[0])).toBe('50')
  })

  it('releases the drag from a pointerup that lands anywhere in the container', () => {
    const fixture = mount(TWO_PANES)
    stubCapture(fixture.dividers)
    const divider = fixture.dividers[0] as HTMLElement

    divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    divider.dispatchEvent(pointer('pointermove', { clientX: 80, pointerId: 1 }))
    expect(divider.getAttribute('aria-valuenow'), 'the drag moved it').toBe('50')

    // Released from the **other pane** — not from the divider.
    ;(fixture.panes[1] as HTMLElement).dispatchEvent(
      pointer('pointerup', { clientX: 80, pointerId: 1 })
    )
    // A later move must do nothing, which is what ending the drag means.
    ;(fixture.panes[0] as HTMLElement).dispatchEvent(
      pointer('pointermove', { clientX: 400, pointerId: 1 })
    )
    expect(divider.getAttribute('aria-valuenow'), 'the release ended the drag').toBe('50')
  })

  it('keeps working when the container contents are replaced, with no re-attach', () => {
    /**
     * The browser-measured defect, as a unit test.
     *
     * The framework replaced the preview's `innerHTML` **17 ms after** the wiring
     * ran, with the row already present, and **no React dependency changed** —
     * `html` was byte-identical. So the effect never re-ran, the boundary list
     * went on holding detached dividers, and every lookup missed: the container
     * listener still fired, still got the right event on the right target, still
     * did not throw, and silently did nothing. Drag and keyboard were dead on
     * every page opened from the sidebar, and worked only after an Edit →
     * Preview round trip, which does change a dependency.
     *
     * The fix is that the wiring watches the container itself, so the list cannot
     * be a stale snapshot. This asserts exactly that, and deliberately does
     * **not** re-attach — doing so would pass against the broken design.
     */
    const document = sharedDom().window.document
    const container = document.createElement('div')
    document.body.append(container)
    container.innerHTML = renderMarkdown(TWO_PANES)
    measureRow(container)
    const detach = attach(container)

    // The framework's own swap: same HTML, brand-new divider nodes.
    container.innerHTML = renderMarkdown(TWO_PANES)
    measureRow(container)

    // A MutationObserver callback is a task, not a microtask, even in jsdom.
    return settle().then(() => {
      const divider = container.querySelector('.rt-cols__divider') as HTMLElement
      stubCapture([divider])

      divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
      divider.dispatchEvent(pointer('pointermove', { clientX: 80, pointerId: 1 }))

      expect(
        divider.getAttribute('aria-valuenow'),
        'the drag must drive the divider that replaced the wired one'
      ).toBe('50')
      detach()
    })
  })

  it('keeps the keyboard working after the container contents are replaced', () => {
    const document = sharedDom().window.document
    const container = document.createElement('div')
    document.body.append(container)
    container.innerHTML = renderMarkdown(TWO_PANES)
    measureRow(container)
    const detach = attach(container)

    container.innerHTML = renderMarkdown(TWO_PANES)
    measureRow(container)

    return settle().then(() => {
      const divider = container.querySelector('.rt-cols__divider') as HTMLElement
      expect(
        divider.getAttribute('aria-valuenow'),
        'the new divider keeps its authored width'
      ).toBe('40')
      divider.dispatchEvent(key('ArrowRight'))
      expect(
        divider.getAttribute('aria-valuenow'),
        'a key must move the divider that replaced the wired one'
      ).toBe('60')
      detach()
    })
  })

  it('is not wedged when setPointerCapture throws, as it can in a real browser', () => {
    /**
     * A robustness defect, proven rather than hypothesised.
     *
     * `createDividerDrag.pointerDown` calls `setPointerCapture`, which is the one
     * call in that path a real browser can throw from — `NotFoundError` for a
     * pointerId that is not active. The wiring used to record the active
     * boundary **before** delegating, so a throw left the wiring believing a drag
     * was in progress while the drag object believed none was: every subsequent
     * `pointermove` was dispatched into a dead drag, `aria-valuenow` never moved,
     * and — because the active boundary is never cleared — **every later drag on
     * the page was refused too**. The symptom is exactly "the pane did not move",
     * and it is permanent rather than intermittent.
     *
     * jsdom has no pointer capture, so this is the only place the throw can be
     * produced at all; the stub below is what makes it testable.
     */
    const fixture = mount(TWO_PANES)
    const divider = fixture.dividers[0] as HTMLElement
    divider.setPointerCapture = (): void => {
      throw new DOMException('pointer is not active', 'NotFoundError')
    }

    // A throwing capture must not take the wiring down with it.
    expect(() =>
      divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    ).not.toThrow()

    // And the next drag must still work, which is the part that was permanently
    // broken before.
    stubCapture(fixture.dividers)
    divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 2 }))
    divider.dispatchEvent(pointer('pointermove', { clientX: 80, pointerId: 2 }))
    expect(
      divider.getAttribute('aria-valuenow'),
      'a later drag must still work after a failed capture'
    ).toBe('50')
  })
})
