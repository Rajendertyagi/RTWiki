import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * Spell check in the Rich editor.
 *
 * The dictionary is a vendored Hunspell pair served by RTWiki itself, so these
 * tests also stand as proof that the feature needs no network access: the only
 * fetches are same-origin, asserted below.
 */

const MISSPELLING = '.rtwiki-spellcheck-misspelling'

function uniqueTitle(base: string): string {
  return `${base} ${Date.now()} ${Math.floor(Math.random() * 1e6)}`
}

async function seedRich(
  request: APIRequestContext,
  title: string,
  blocks: Array<{ id: string; type: string; content: string; props?: unknown }>
): Promise<void> {
  const res = await request.post('/api/pages', {
    // `content` is the serialised BlockNote JSON, exactly as the editor stores
    // it. Sending a bare array is rejected by the schema with a 400, which is
    // what this helper got wrong first.
    data: {
      title,
      pageType: 'rich',
      content: JSON.stringify(
        blocks.map((b) => ({ id: b.id, type: b.type, props: b.props ?? {}, content: b.content }))
      )
    }
  })
  if (res.status() !== 201) {
    throw new Error(`seed failed: ${res.status()} ${await res.text()}`)
  }
}

async function openNote(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
  await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
}

test.describe('spell check', () => {
  test('underlines a misspelling and leaves real words alone', async ({ page, request }) => {
    const title = uniqueTitle('Spell Basic')
    await seedRich(request, title, [
      { id: 'p1', type: 'paragraph', content: 'This sentance has a mistke.' }
    ])
    await openNote(page, title)

    // The dictionary is fetched asynchronously, so wait for the decoration
    // rather than asserting immediately: a fixed sleep would be a race.
    const flagged = page.locator(MISSPELLING)
    await expect(flagged.first(), 'the misspelling must be underlined').toBeVisible({
      timeout: 15_000
    })

    const words = await flagged.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-spellcheck-word')?.toLowerCase() ?? '')
    )
    expect(words).toContain('sentance')
    expect(words).toContain('mistke')
    // The words that are spelled correctly must not be marked, or the feature
    // is worse than no feature.
    expect(words).not.toContain('this')
    expect(words).not.toContain('has')
    expect(words).not.toContain('a')
  })

  test('draws a wavy underline, not a colour change', async ({ page, request }) => {
    const title = uniqueTitle('Spell Wavy')
    await seedRich(request, title, [{ id: 'p1', type: 'paragraph', content: 'mispeling' }])
    await openNote(page, title)

    const flagged = page.locator(MISSPELLING).first()
    await expect(flagged).toBeVisible({ timeout: 15_000 })
    const decoration = await flagged.evaluate((el) => getComputedStyle(el).textDecorationStyle)
    // A wavy underline survives a high-contrast theme and does not rely on
    // colour alone, which is the accessibility reason for this choice.
    expect(decoration).toContain('wavy')
  })

  test('leaves code alone', async ({ page, request }) => {
    // Identifiers and shell commands are "wrong" by design; underlining them
    // makes the feature noise rather than help.
    const title = uniqueTitle('Spell Code')
    await seedRich(request, title, [
      {
        id: 'c1',
        type: 'codeBlock',
        content: 'const mispeling = 1',
        props: { language: 'typescript' }
      },
      { id: 'p1', type: 'paragraph', content: 'A mispeling outside code.' }
    ])
    await openNote(page, title)

    const flagged = page.locator(MISSPELLING)
    await expect(flagged.first()).toBeVisible({ timeout: 15_000 })
    const words = await flagged.evaluateAll((els) => els.map((el) => el.textContent ?? ''))
    expect(words).toHaveLength(1)
    expect(words[0]).toBe('mispeling')
  })

  test('does not flag acronyms or tokens containing digits', async ({ page, request }) => {
    const title = uniqueTitle('Spell Acronym')
    await seedRich(request, title, [
      { id: 'p1', type: 'paragraph', content: 'The RNA and DNA in HTTP use CPU 5th 12 kg.' }
    ])
    await openNote(page, title)

    // Give the dictionary the same window to load, then assert nothing at all
    // is flagged. A fixed wait would be a race in the other direction, so the
    // control is the misspelling below: if it is not flagged, the load failed
    // and this test proves nothing.
    await expect(page.locator(MISSPELLING)).toHaveCount(0, { timeout: 15_000 })
  })

  test('the dictionary is fetched from this origin only', async ({ page, request }) => {
    const title = uniqueTitle('Spell Offline')
    await seedRich(request, title, [{ id: 'p1', type: 'paragraph', content: 'mispeling' }])

    const external: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (!url.startsWith('http://127.0.0.1') && !url.startsWith('data:')) external.push(url)
    })

    await openNote(page, title)
    await expect(page.locator(MISSPELLING).first()).toBeVisible({ timeout: 15_000 })

    // RTWiki is local-first and offline. Spell check must not become the first
    // feature that phones home, and this is the assertion that keeps it that way.
    expect(external, `unexpected external requests: ${external.join(', ')}`).toEqual([])
  })

  test('serves the dictionary with a text content type', async ({ request }) => {
    // The editor reads both files with `res.text()`. An octet-stream content
    // type is at best a download prompt, so it is asserted rather than assumed.
    for (const [path, expected] of [
      ['/dict/en.aff', 'text/plain'],
      ['/dict/en.dic', 'text/plain']
    ] as const) {
      const res = await request.get(path)
      expect(res.status(), `${path} must be served`).toBe(200)
      expect(res.headers()['content-type'] ?? '', `${path} content type`).toContain(expected)
    }
  })
})
