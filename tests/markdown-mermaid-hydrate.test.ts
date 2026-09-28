import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  attachMermaidDiagrams,
  MERMAID_ERROR_CLASS,
  MERMAID_STATE_ATTRIBUTE,
  MERMAID_STATE_ERROR,
  MERMAID_STATE_PENDING,
  MERMAID_STATE_RENDERED,
  type MermaidDiagramRender,
  mermaidBlockId
} from '../src/web/features/markdown/markdown-mermaid-hydrate.js'
import { sharedDom } from './utils/dom-harness.js'

/**
 * Phase B of the ` ```mermaid ` fence: the hydration half.
 *
 * ## What is under test and what is not
 *
 * The **state machine** is here: which nodes are written, when a stale render is
 * allowed to write, what a reader is shown on failure, and - the part that has
 * bitten this feature twice - that the wiring survives the framework replacing
 * the preview's `innerHTML`. Every one of those is driven through an injected
 * `render` function, so nothing here configures Mermaid, imports it, or depends
 * on a diagram type being resolvable.
 *
 * What a unit test **cannot** see, and what
 * `tests/browser/markdown-mermaid.pwspec.ts` exists for: that a real Mermaid
 * renders inside the real preview, that the observer fires on the replacement
 * React actually performs, and that the SVG is painted with readable labels in
 * both colour schemes. jsdom never replaces the container's contents on its own,
 * which is precisely the event this feature is arranged around.
 */

/** One call the fake renderer received. */
interface RenderCall {
  source: string
  blockId: string
  theme: 'default' | 'dark'
  signal: AbortSignal
}

interface FakeRenderer {
  calls: RenderCall[]
  render: MermaidDiagramRender
}

const SVG = '<svg id="drawn" xmlns="http://www.w3.org/2000/svg"><g></g></svg>'

/** A renderer that succeeds, and records what it was asked for. */
function succeeding(): FakeRenderer {
  const calls: RenderCall[] = []
  const render: MermaidDiagramRender = (source, options) => {
    calls.push({ source, blockId: options.blockId, theme: options.theme, signal: options.signal })
    return Promise.resolve({ ok: true, svg: SVG })
  }
  return { calls, render }
}

/**
 * A renderer whose each call is settled by the test, so a slow render and a
 * fast one can be ordered deliberately.
 *
 * `settle(index, result)` resolves the `index`-th call. A call whose signal was
 * aborted first resolves to `cancelled` instead, which is what the real
 * `renderMermaidSvg` does and what makes the two indistinguishable to this
 * module unless it gets the generation right.
 */
function controllable(): FakeRenderer & {
  settle: (index: number, svg?: string) => void
  cancelled: () => number[]
} {
  const calls: RenderCall[] = []
  const resolvers: Array<
    (value: { ok: true; svg: string } | { ok: false; code: 'cancelled' }) => void
  > = []
  const render: MermaidDiagramRender = (source, options) => {
    calls.push({ source, blockId: options.blockId, theme: options.theme, signal: options.signal })
    return new Promise((resolve) => {
      resolvers.push(resolve)
      options.signal.addEventListener('abort', () => {
        resolve({ ok: false, code: 'cancelled' })
      })
    })
  }
  return {
    calls,
    render,
    settle: (index, svg = SVG) => resolvers[index]?.({ ok: true, svg }),
    cancelled: () => calls.filter((c) => c.signal.aborted).map((c) => calls.indexOf(c))
  }
}

const escapeText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * A preview element holding one placeholder per source, exactly as the parser
 * emits them and exactly as the framework hands them over: markup in
 * `innerHTML`, source as element **text**.
 */
function preview(sources: string[]): HTMLElement {
  const container = document.createElement('div')
  container.innerHTML = sources
    .map(
      (source) =>
        `<div class="rt-mermaid"><pre class="rt-mermaid-source">${escapeText(source)}</pre></div>`
    )
    .join('')
  document.body.append(container)
  return container
}

const placeholdersIn = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('.rt-mermaid'))

const svgIn = (element: HTMLElement): SVGElement | null => element.querySelector('svg')

const sourceIn = (element: HTMLElement): HTMLElement | null =>
  element.querySelector<HTMLElement>('.rt-mermaid-source')

/** One turn of the microtask queue plus one macrotask: promises and jsdom's observer. */
const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0)
  })

const PAGE = 'page-under-test'

beforeAll(() => {
  sharedDom()
})

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('hydrating a diagram placeholder', () => {
  it('puts the diagram in the placeholder', async () => {
    const container = preview(['graph TD; A-->B;'])
    const fake = succeeding()

    attachMermaidDiagrams(container, { pageId: PAGE, theme: 'default', render: fake.render })
    await flush()

    expect(placeholdersIn(container)).toHaveLength(1)
    expect(svgIn(placeholdersIn(container)[0] as HTMLElement)).not.toBeNull()
  })

  it('hands the renderer the source byte-exact', async () => {
    // The transport constraint from the parser half: `-->` is in a text node,
    // because DOMPurify's SAFE_FOR_XML check drops it from any attribute value.
    // A hydration module that reassembled the source by another route would
    // lose the arrow, and the diagram would silently not be a diagram.
    const source = 'graph TD\n  A["quoted"]-->B{"braced"};\n  B -->|yes| C[Done]'
    const container = preview([source])
    const fake = succeeding()

    attachMermaidDiagrams(container, { pageId: PAGE, theme: 'default', render: fake.render })
    await flush()

    expect(fake.calls[0]?.source).toBe(source)
  })

  it('asks for a diagram, never a mind map, and passes the theme through', async () => {
    const container = preview(['graph TD; A-->B;'])
    const fake = succeeding()
    // `blockType` is a literal in the module, so it cannot be observed from the
    // call record; the theme can, and a hard-coded one would be a real defect.
    attachMermaidDiagrams(container, { pageId: PAGE, theme: 'dark', render: fake.render })
    await flush()

    expect(fake.calls[0]?.theme).toBe('dark')
  })

  it('hides the source rather than removing it', async () => {
    // The source is the reader's content. It must survive a successful render,
    // because a reader who selects the page and copies it has to get the
    // diagram back, not a picture of one - and because a render error shows it.
    const container = preview(['graph TD; A-->B;'])
    const fake = succeeding()

    attachMermaidDiagrams(container, { pageId: PAGE, theme: 'default', render: fake.render })
    await flush()

    const element = placeholdersIn(container)[0] as HTMLElement
    const source = sourceIn(element)
    expect(source, 'the source element was removed by a successful render').not.toBeNull()
    expect(source?.isConnected, 'the source element was detached').toBe(true)
    expect(source?.textContent).toBe('graph TD; A-->B;')
    expect(source?.hidden, 'the source is showing under the diagram').toBe(true)
    expect(element.getAttribute(MERMAID_STATE_ATTRIBUTE)).toBe(MERMAID_STATE_RENDERED)
  })

  it('keeps the source on screen while the render is in flight', async () => {
    // "No layout hole while rendering." The placeholder is showing the source
    // from the first scan until the SVG lands, which is why a slow Mermaid does
    // not leave a gap in the page.
    const container = preview(['graph TD; A-->B;'])
    const fake = controllable()
    const detach = attachMermaidDiagrams(container, {
      pageId: PAGE,
      theme: 'default',
      render: fake.render
    })

    const element = placeholdersIn(container)[0] as HTMLElement
    expect(element.getAttribute(MERMAID_STATE_ATTRIBUTE)).toBe(MERMAID_STATE_PENDING)
    expect(sourceIn(element)?.hidden).toBe(false)
    expect(svgIn(element)).toBeNull()

    fake.settle(0)
    await flush()
    detach()
    expect(svgIn(element)).not.toBeNull()
  })
})

describe('two fences on one page', () => {
  it('are given different render identities', async () => {
    // The collision case. `renderMermaidSvg` derives the SVG's element id from
    // this string, so two fences sharing one id would put two diagrams' node
    // sets under the same `id` in one document.
    const container = preview(['graph TD; A-->B;', 'graph LR; C-->D;'])
    const fake = succeeding()

    attachMermaidDiagrams(container, { pageId: PAGE, theme: 'default', render: fake.render })
    await flush()

    expect(fake.calls).toHaveLength(2)
    expect(fake.calls[0]?.blockId).not.toBe(fake.calls[1]?.blockId)
  })

  it('are given different render identities even when one arrives late', async () => {
    // The case a position alone does not cover. A **partial** addition - a node
    // arriving while the others stay put - can put a newcomer on an index a
    // still-connected placeholder already holds, because the existing one keeps
    // the identity it was assigned. Nothing in the framework does this today;
    // the guarantee is here so it cannot be introduced by accident.
    const container = preview(['graph TD; A-->B;'])
    const fake = succeeding()
    const detach = attachMermaidDiagrams(container, {
      pageId: PAGE,
      theme: 'default',
      render: fake.render
    })
    await flush()
    expect(fake.calls[0]?.blockId).toBe(mermaidBlockId(PAGE, 0))

    const extra = document.createElement('div')
    extra.className = 'rt-mermaid'
    const extraSource = document.createElement('pre')
    extraSource.className = 'rt-mermaid-source'
    extraSource.textContent = 'graph LR; C-->D;'
    extra.append(extraSource)
    container.prepend(extra)
    await flush()

    expect(fake.calls).toHaveLength(2)
    expect(fake.calls[1]?.blockId).not.toBe(fake.calls[0]?.blockId)
    detach()
  })

  it('is what a page id is for', () => {
    expect(mermaidBlockId('page-a', 0)).not.toBe(mermaidBlockId('page-b', 0))
    expect(mermaidBlockId('page-a', 0)).not.toBe(mermaidBlockId('page-a', 1))
  })
})

describe('a replacement of the preview contents', () => {
  /**
   * The reason this module exists, and the reason it cannot be a React effect
   * keyed on the rendered HTML.
   *
   * The framework replaces the preview's `innerHTML` outright, so the
   * placeholders a wiring captured are **detached** the moment it runs, and no
   * React dependency changed - the new HTML is not required to differ. A lookup
   * that holds the old nodes then misses forever, silently: nothing throws, the
   * container is still there, and the reader simply has no diagram.
   *
   * Measured in a browser on the built app, with the module instrumented: the
   * framework writes the preview's children at 1105 ms, the module's first scan
   * runs at 1115 ms and does find the placeholder, and the framework writes the
   * children **again** at 1164 ms with new nodes - so the render the first scan
   * started lands in a node nobody can see. Separately, the same diagram's node
   * identity went 1 -> 2 -> 3 across two Edit -> Preview round trips.
   *
   * jsdom never replaces a container's contents on its own, so the event these
   * tests replay cannot be produced here by anything but the test itself. That is
   * why the browser spec has one too.
   */
  it('hydrates the placeholders that replace the ones it started with', async () => {
    const container = preview(['graph TD; A-->B;'])
    const fake = succeeding()
    const detach = attachMermaidDiagrams(container, {
      pageId: PAGE,
      theme: 'default',
      render: fake.render
    })
    await flush()
    const original = placeholdersIn(container)[0] as HTMLElement
    expect(svgIn(original)).not.toBeNull()

    // What the framework does: the same markup, written again, as new nodes.
    const replacement = preview(['graph TD; A-->B;'])
    container.innerHTML = replacement.innerHTML
    await flush()

    expect(fake.calls, 'the replacement placeholders were never rendered').toHaveLength(2)
    const current = placeholdersIn(container)[0] as HTMLElement
    expect(current).not.toBe(original)
    expect(original.isConnected, 'the old node should be gone from the document').toBe(false)
    expect(svgIn(current), 'the new placeholder has no diagram').not.toBeNull()
    detach()
  })

  it('gives a replacement the same identity the original had', async () => {
    // Determinism, and the reason a **counter** was rejected: a counter resets
    // on a re-render, so the same fence would change identity every keystroke.
    const container = preview(['graph TD; A-->B;', 'graph LR; C-->D;'])
    const fake = succeeding()
    const detach = attachMermaidDiagrams(container, {
      pageId: PAGE,
      theme: 'default',
      render: fake.render
    })
    await flush()
    const before = fake.calls.map((call) => call.blockId)

    const replacement = preview(['graph TD; A-->B;', 'graph LR; C-->D;'])
    container.innerHTML = replacement.innerHTML
    await flush()

    expect(fake.calls.slice(2).map((call) => call.blockId)).toEqual(before)
    detach()
  })

  it('does not re-render a placeholder that is still there', async () => {
    // The observer watches the **container's** child list, not the subtree, so
    // this module's own insertion of an SVG cannot re-enter the scan. If it
    // could, every render would restart itself and nothing would ever finish.
    const container = preview(['graph TD; A-->B;'])
    const fake = succeeding()
    const detach = attachMermaidDiagrams(container, {
      pageId: PAGE,
      theme: 'default',
      render: fake.render
    })
    await flush()
    expect(fake.calls).toHaveLength(1)

    // A sibling the framework would also have written, appended in its own right.
    const paragraph = document.createElement('p')
    paragraph.textContent = 'after'
    container.append(paragraph)
    await flush()

    expect(fake.calls, 'an unrelated child change restarted the render').toHaveLength(1)
    detach()
  })
})

describe('a failed render', () => {
  it('shows the source and a message, and never a blank box', async () => {
    const source = 'graph TD; A-->'
    const container = preview([source])
    const render: MermaidDiagramRender = () => Promise.resolve({ ok: false, code: 'parse_error' })

    const detach = attachMermaidDiagrams(container, { pageId: PAGE, theme: 'default', render })
    await flush()

    const element = placeholdersIn(container)[0] as HTMLElement
    expect(svgIn(element), 'a failed render drew something').toBeNull()
    expect(element.getAttribute(MERMAID_STATE_ATTRIBUTE)).toBe(MERMAID_STATE_ERROR)

    const shown = sourceIn(element)
    expect(shown, "the source is the reader's content and must survive a failure").not.toBeNull()
    expect(shown?.textContent).toBe(source)
    expect(shown?.hidden, 'the source is hidden behind an error').toBe(false)

    const message = element.querySelector(`.${MERMAID_ERROR_CLASS}`)
    expect(message, 'a failure with no message is a silent failure').not.toBeNull()
    expect(message?.textContent).not.toBe('')
    expect(message?.getAttribute('role')).toBe('alert')
    detach()
  })

  it('says the same thing for a render failure as for a parse failure', async () => {
    // The editor's Diagram block maps both codes to one string
    // (`mermaid-block-view.tsx`, `ERROR_MESSAGES`), and so does this, because
    // the two are the same to a reader and the difference is not actionable.
    const say = async (code: 'parse_error' | 'render_error'): Promise<string | null> => {
      document.body.innerHTML = ''
      const container = preview(['graph TD; A-->B;'])
      const detach = attachMermaidDiagrams(container, {
        pageId: PAGE,
        theme: 'default',
        render: () => Promise.resolve({ ok: false, code })
      })
      await flush()
      const text = container.querySelector(`.${MERMAID_ERROR_CLASS}`)?.textContent ?? null
      detach()
      return text
    }
    expect(await say('parse_error')).toBe(await say('render_error'))
  })

  it('takes its message from the shared UI text dictionary', () => {
    // No user-facing string is written in the feature module (AGENTS.md §8). The
    // dictionary is imported, so the assertion is on the source: the only
    // user-visible text this module can emit is a `UI_TEXT` value.
    const source = readFileSync('src/web/features/markdown/markdown-mermaid-hydrate.ts', 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n')
    // The only `textContent =` in the module assigns from RENDER_ERROR_MESSAGES.
    expect(source).toContain('UI_TEXT.diagramErrorTitle')
    expect(source.match(/textContent\s*=/g) ?? []).toHaveLength(1)
  })
})

describe('cancellation and supersession', () => {
  it('does not let a slow render overwrite a newer one', async () => {
    // A theme change re-attaches, and the slow render from before it is still
    // in flight. If it were allowed to write, a reader who switched appearance
    // would watch a light diagram replace a dark one a moment later.
    const container = preview(['graph TD; A-->B;'])
    const fake = controllable()

    const first = attachMermaidDiagrams(container, {
      pageId: PAGE,
      theme: 'default',
      render: fake.render
    })
    const slow = fake.calls[0] as RenderCall
    first()

    // The reader switches to the dark scheme: a fresh attachment, same nodes.
    const second = attachMermaidDiagrams(container, {
      pageId: PAGE,
      theme: 'dark',
      render: fake.render
    })
    expect(fake.calls).toHaveLength(2)

    // The new render lands, and only then does the abandoned one resolve.
    fake.settle(1, '<svg id="dark-drawn" xmlns="http://www.w3.org/2000/svg"></svg>')
    await flush()
    expect(svgIn(placeholdersIn(container)[0] as HTMLElement)?.id).toBe('dark-drawn')

    slow.signal.dispatchEvent(new Event('abort'))
    fake.settle(0, '<svg id="stale-drawn" xmlns="http://www.w3.org/2000/svg"></svg>')
    await flush()

    const element = placeholdersIn(container)[0] as HTMLElement
    expect(
      element.innerHTML.includes('stale-drawn'),
      'a superseded render overwrote the current diagram'
    ).toBe(false)
    expect(svgIn(element)?.id).toBe('dark-drawn')
    second()
  })

  it('aborts the render it supersedes', async () => {
    const container = preview(['graph TD; A-->B;'])
    const fake = controllable()
    const first = attachMermaidDiagrams(container, {
      pageId: PAGE,
      theme: 'default',
      render: fake.render
    })
    const slow = fake.calls[0] as RenderCall
    expect(slow.signal.aborted).toBe(false)
    first()
    // `renderMermaidSvg` serialises Mermaid's shared-config critical section, so
    // an abandoned render is not merely wasted: it still holds a queue slot and
    // delays the render that replaced it. The signal is checked twice inside
    // that queue, so aborting actually saves the time.
    expect(slow.signal.aborted, 'the superseded render was left running').toBe(true)
  })

  it('abandons a render whose placeholder was replaced', async () => {
    const container = preview(['graph TD; A-->B;'])
    const fake = controllable()
    const detach = attachMermaidDiagrams(container, {
      pageId: PAGE,
      theme: 'default',
      render: fake.render
    })
    const first = fake.calls[0] as RenderCall

    const replacement = preview(['graph LR; C-->D;'])
    container.innerHTML = replacement.innerHTML
    await flush()

    expect(first.signal.aborted, 'a render for a detached node was left running').toBe(true)
    expect(fake.calls).toHaveLength(2)
    expect(svgIn(placeholdersIn(container)[0] as HTMLElement)).toBeNull()
    detach()
  })

  it('writes nothing after a teardown', async () => {
    const container = preview(['graph TD; A-->B;'])
    const fake = controllable()
    const detach = attachMermaidDiagrams(container, {
      pageId: PAGE,
      theme: 'default',
      render: fake.render
    })
    const inFlight = fake.calls[0] as RenderCall
    detach()

    expect(inFlight.signal.aborted, 'a render outlived the preview').toBe(true)
    fake.settle(0)
    await flush()
    expect(svgIn(placeholdersIn(container)[0] as HTMLElement)).toBeNull()
  })

  it('treats a cancelled render as neither a diagram nor an error', async () => {
    // A cancellation is not a failure. Showing an error for it would put a
    // "Diagram error" on a page whose diagram is merely on its way - and the
    // editor block draws the same line with the same code.
    const container = preview(['graph TD; A-->B;'])
    const render: MermaidDiagramRender = (_source, options) =>
      new Promise((resolve) => {
        options.signal.addEventListener('abort', () => {
          resolve({ ok: false, code: 'cancelled' })
        })
      })
    const detach = attachMermaidDiagrams(container, { pageId: PAGE, theme: 'default', render })
    await flush()
    detach()
    await flush()

    const element = placeholdersIn(container)[0] as HTMLElement
    expect(element.getAttribute(MERMAID_STATE_ATTRIBUTE)).toBe(MERMAID_STATE_PENDING)
    expect(element.querySelector(`.${MERMAID_ERROR_CLASS}`)).toBeNull()
    expect(sourceIn(element)?.hidden, 'the source was hidden for a cancelled render').toBe(false)
  })
})

describe('what this module is forbidden from doing', () => {
  /**
   * The single Mermaid configuration lives in
   * `rich-editor/blocks/mermaid-render.ts`. A second one here would let a
   * Markdown note and a Rich Note disagree about `securityLevel`, which is a
   * security boundary rather than a detail. The parser half already has this
   * test; this is its counterpart for the half that actually renders.
   */
  it('adds no Mermaid option of its own', async () => {
    const source = await Bun.file('src/web/features/markdown/markdown-mermaid-hydrate.ts').text()
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n')

    expect(code).not.toMatch(/\bsecurityLevel\b/)
    expect(code).not.toMatch(/\bMERMAID_CONFIG\b/)
    expect(code).not.toMatch(/mermaid\s*\.\s*(render|initialize|parse)\s*\(/)
    // The renderer is a **parameter**, so the module cannot reach Mermaid's own
    // renderer even by accident. A value import would break that.
    expect(code).not.toMatch(/^import\s+(?!type\s).*mermaid-render/m)
    expect(code).toMatch(
      /^import type \{[^}]*\} from '\.\.\/rich-editor\/blocks\/mermaid-render\.js'/m
    )
  })
})
