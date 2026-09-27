import type { APIRequestContext } from '@playwright/test'

/**
 * Removes leftover 'Untitled' pages from the shared dev database.
 *
 * Creation-menu tests intentionally produce them; other suites fill dialog
 * fields via getByLabel('Title'), which substring-matches every tree row
 * labelled "Open Untitled" / "Actions for Untitled". The list endpoint is
 * paginated, so this loops bounded windows until a sweep removes nothing.
 */
export async function purgeUntitledPages(request: APIRequestContext): Promise<void> {
  for (let sweep = 0; sweep < 50; sweep++) {
    const res = await request.get('/api/pages?limit=200')
    const list = (await res.json()) as { pages: Array<{ id: string; title: string }> }
    const targets = list.pages.filter((p) => p.title === 'Untitled')
    if (targets.length === 0) return
    for (const page of targets) {
      await request.delete(`/api/pages/${page.id}`)
    }
  }
}

/**
 * Removes every page from the shared dev database.
 *
 * ## Why a spec would need this
 *
 * The suite shares one long-lived database and a full run accumulates well over a
 * thousand pages. The sidebar tree is virtualised, so a spec that must interact
 * with a *tree row* — expanding it, right-clicking it, renaming it with F2 —
 * cannot reach a page that is buried hundreds of rows down: the row is not in the
 * DOM, and scrolling for it does not reliably reach it.
 *
 * Specs that only need to *open* a page should not use this. They should use
 * `openPageViaFinder`, which finds a page at any database size. This is for the
 * specs whose subject is the tree itself.
 *
 * Safe under `workers: 1`: a file's `beforeAll` runs after the previous file has
 * finished, so a spec that seeds its own pages is unaffected.
 */
export async function purgeAllPages(request: APIRequestContext): Promise<void> {
  for (let sweep = 0; sweep < 200; sweep++) {
    const res = await request.get('/api/pages?limit=200')
    const list = (await res.json()) as { pages: Array<{ id: string }> }
    if (list.pages.length === 0) return
    for (const page of list.pages) {
      await request.delete(`/api/pages/${page.id}`)
    }
  }
}
