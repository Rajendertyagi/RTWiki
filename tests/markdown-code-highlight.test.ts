import { describe, expect, it } from 'bun:test'
import { attachCodeHighlighting } from '../src/web/features/markdown/markdown-code-highlight.js'
import { sharedDom } from './utils/dom-harness.js'

sharedDom()

/** Waits for every pending microtask and timer the pass schedules. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function container(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.append(el)
  return el
}

const FENCE = '<pre><code class="language-js">const a = 1</code></pre>'

describe('markdown code highlighting: attachment', () => {
  it('highlights a fenced block and marks it done', async () => {
    const host = container(FENCE)
    const teardown = attachCodeHighlighting(host, {
      colorScheme: 'light',
      highlight: async () => ({ kind: 'highlighted', html: '<span class="k">const</span>' })
    })
    await settle()

    const code = host.querySelector('code')
    expect(code?.getAttribute('data-rt-code-state')).toBe('done')
    expect(code?.innerHTML).toContain('class="k"')
    teardown()
  })

  it('leaves an unlabelled fence completely alone', async () => {
    const host = container('<pre><code>plain</code></pre>')
    let called = 0
    const teardown = attachCodeHighlighting(host, {
      colorScheme: 'light',
      highlight: async () => {
        called++
        return { kind: 'highlighted', html: 'x' }
      }
    })
    await settle()

    expect(called).toBe(0)
    const code = host.querySelector('code')
    expect(code?.hasAttribute('data-rt-code-state')).toBe(false)
    expect(code?.textContent).toBe('plain')
    teardown()
  })

  it('skips an unknown language without calling the engine', async () => {
    const host = container('<pre><code class="language-rust">fn main(){}</code></pre>')
    let called = 0
    const teardown = attachCodeHighlighting(host, {
      colorScheme: 'light',
      highlight: async () => {
        called++
        return { kind: 'highlighted', html: 'x' }
      }
    })
    await settle()

    expect(called).toBe(0)
    expect(host.querySelector('code')?.textContent).toBe('fn main(){}')
    teardown()
  })

  it('marks a plain outcome as done, so it is never retried forever', async () => {
    const host = container(FENCE)
    const teardown = attachCodeHighlighting(host, {
      colorScheme: 'light',
      highlight: async () => ({ kind: 'plain', reason: 'highlight_failed' })
    })
    await settle()

    const code = host.querySelector('code')
    expect(code?.getAttribute('data-rt-code-state')).toBe('plain')
    // The text must survive: a failed highlight degrades to plain, never to blank.
    expect(code?.textContent).toBe('const a = 1')
    teardown()
  })

  it('survives a throwing engine and still leaves the code readable', async () => {
    const host = container(FENCE)
    const teardown = attachCodeHighlighting(host, {
      colorScheme: 'light',
      highlight: async () => {
        throw new Error('grammar exploded')
      }
    })
    await settle()

    const code = host.querySelector('code')
    expect(code?.getAttribute('data-rt-code-state')).toBe('failed')
    expect(code?.textContent).toBe('const a = 1')
    teardown()
  })

  it('does not highlight the same block twice when the observer re-fires', async () => {
    const host = container(FENCE)
    let called = 0
    const teardown = attachCodeHighlighting(host, {
      colorScheme: 'light',
      highlight: async () => {
        called++
        return { kind: 'highlighted', html: '<span>x</span>' }
      }
    })
    await settle()
    // Force several more scans.
    for (let i = 0; i < 3; i++) {
      host.append(document.createElement('i'))
      await settle()
    }

    expect(called).toBe(1)
    teardown()
  })

  it('picks up a block added after attachment, which is the real-frame race', async () => {
    const host = container('<p>empty</p>')
    const teardown = attachCodeHighlighting(host, {
      colorScheme: 'light',
      highlight: async () => ({ kind: 'highlighted', html: '<span>y</span>' })
    })
    await settle()
    expect(host.querySelector('code')).toBeNull()

    // The framework replacing innerHTML is exactly this.
    host.innerHTML = FENCE
    await settle()

    expect(host.querySelector('code')?.getAttribute('data-rt-code-state')).toBe('done')
    teardown()
  })

  it('writes nothing after teardown', async () => {
    const host = container(FENCE)
    let resolveHighlight: (v: { kind: 'highlighted'; html: string }) => void = () => {}
    const teardown = attachCodeHighlighting(host, {
      colorScheme: 'light',
      highlight: () =>
        new Promise((resolve) => {
          resolveHighlight = resolve
        })
    })
    await settle()

    const code = host.querySelector('code')
    const before = code?.innerHTML
    teardown()
    resolveHighlight({ kind: 'highlighted', html: '<span>too late</span>' })
    await settle()

    expect(code?.innerHTML).toBe(before)
    expect(code?.getAttribute('data-rt-code-state')).toBe('pending')
  })

  it('does not write to a node the framework already replaced', async () => {
    const host = container(FENCE)
    const original = host.querySelector('code')
    let resolveHighlight: (v: { kind: 'highlighted'; html: string }) => void = () => {}
    const teardown = attachCodeHighlighting(host, {
      colorScheme: 'light',
      highlight: () =>
        new Promise((resolve) => {
          resolveHighlight = resolve
        })
    })
    await settle()

    // Replace the whole preview while the highlight is in flight.
    host.innerHTML = '<pre><code class="language-js">newer</code></pre>'
    resolveHighlight({ kind: 'highlighted', html: '<span>stale</span>' })
    await settle()

    expect(original?.innerHTML).toBe('const a = 1')
    expect(host.querySelector('code')?.textContent).not.toContain('stale')
    teardown()
  })

  it('passes the colour scheme through to the engine', async () => {
    const seen: string[] = []
    for (const scheme of ['light', 'dark'] as const) {
      const host = container(FENCE)
      const teardown = attachCodeHighlighting(host, {
        colorScheme: scheme,
        highlight: async (_code, _info, got) => {
          seen.push(got)
          return { kind: 'highlighted', html: '<span>s</span>' }
        }
      })
      await settle()
      teardown()
    }
    expect(seen).toEqual(['light', 'dark'])
  })

  it('recovers the fence info from the class micromark emitted', async () => {
    const host = container('<pre><code class="language-ts">const a: number = 1</code></pre>')
    // `string | undefined` rather than `string`, because that is the parameter's
    // declared type and the assertion below is what proves it received 'ts'.
    let info: string | null | undefined
    const teardown = attachCodeHighlighting(host, {
      colorScheme: 'light',
      highlight: async (_code, got) => {
        info = got
        return { kind: 'highlighted', html: '<span>t</span>' }
      }
    })
    await settle()

    expect(info).toBe('ts')
    teardown()
  })
})
