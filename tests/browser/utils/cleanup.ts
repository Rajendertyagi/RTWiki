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
