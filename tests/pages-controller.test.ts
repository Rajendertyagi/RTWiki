import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from '../src/server/app.js'
import { closeDatabase, type getDb, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import type { Page } from '../src/shared/contracts/pages.js'
import {
  filterPagesByQuery,
  findPageById,
  findSelectionAfterDeletion,
  syncSelectionWithPages
} from '../src/web/hooks/pages-controller-utils.js'

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `rtwiki-ctrl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

// --- Pure utility function tests ---

describe('pages-controller-utils', () => {
  const now = new Date().toISOString()
  const samplePage: Page = {
    id: 'p1',
    title: 'Test Page',
    content: 'Hello',
    pageType: 'rich',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  }

  describe('findSelectionAfterDeletion', () => {
    it('returns null when no page is selected', () => {
      expect(findSelectionAfterDeletion(null, 'p1')).toBeNull()
    })

    it('returns null when the selected page is deleted', () => {
      expect(findSelectionAfterDeletion(samplePage, 'p1')).toBeNull()
    })

    it('preserves selection when a different page is deleted', () => {
      const result = findSelectionAfterDeletion(samplePage, 'p2')
      expect(result).toBe(samplePage)
    })
  })

  describe('syncSelectionWithPages', () => {
    it('returns null when no page is selected', () => {
      expect(syncSelectionWithPages(null, [samplePage])).toBeNull()
    })

    it('returns the page when it exists in the list', () => {
      const result = syncSelectionWithPages(samplePage, [samplePage])
      expect(result).not.toBeNull()
      expect(result?.id).toBe('p1')
    })

    it('returns null when the selected page is not in the list', () => {
      const result = syncSelectionWithPages(samplePage, [])
      expect(result).toBeNull()
    })

    it('returns null when the selected page was deleted from the list', () => {
      const otherPage: Page = { ...samplePage, id: 'p2', title: 'Other' }
      const result = syncSelectionWithPages(samplePage, [otherPage])
      expect(result).toBeNull()
    })
  })

  describe('findPageById', () => {
    it('finds a page by ID', () => {
      const result = findPageById([samplePage], 'p1')
      expect(result).toBe(samplePage)
    })

    it('returns null for unknown ID', () => {
      const result = findPageById([samplePage], 'unknown')
      expect(result).toBeNull()
    })

    it('returns null for empty list', () => {
      const result = findPageById([], 'p1')
      expect(result).toBeNull()
    })
  })

  describe('filterPagesByQuery', () => {
    const pages: Page[] = [
      samplePage,
      { ...samplePage, id: 'p2', title: 'Another Page' },
      { ...samplePage, id: 'p3', title: 'Third' }
    ]

    it('returns all pages for empty query', () => {
      expect(filterPagesByQuery(pages, '')).toHaveLength(3)
    })

    it('filters by title substring (case-insensitive)', () => {
      const result = filterPagesByQuery(pages, 'test')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('p1')
    })

    it('filters with mixed case', () => {
      const result = filterPagesByQuery(pages, 'ANOTHER')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('p2')
    })

    it('returns empty for no match', () => {
      const result = filterPagesByQuery(pages, 'nonexistent')
      expect(result).toHaveLength(0)
    })
  })
})

// --- API integration tests against real Hono server ---

describe('page API integration', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>
  let serverPort: number

  beforeAll(async () => {
    tempDir = makeTempDir()
    db = initDatabase(tempDir)
    await runMigrations(db)

    // Start the real app on a random port for integration testing.
    const server = Bun.serve({
      fetch: app.fetch,
      port: 0,
      hostname: '127.0.0.1'
    })
    serverPort = server.port as number
  })

  afterAll(async () => {
    await closeDatabase()
    cleanup(tempDir)
  })

  const API = () => `http://127.0.0.1:${serverPort}`

  it('creates a page via API', async () => {
    const res = await fetch(`${API()}/api/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Integration Test Page', pageType: 'rich' })
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { page: Page }
    expect(body.page.title).toBe('Integration Test Page')
    expect(body.page.pageType).toBe('rich')
    expect(body.page.id).toBeDefined()
  })

  it('lists pages via API', async () => {
    const res = await fetch(`${API()}/api/pages`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { pages: Page[]; total: number }
    expect(body.pages.length).toBeGreaterThan(0)
  })

  it('updates a page title via API', async () => {
    // First create a page.
    const createRes = await fetch(`${API()}/api/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'To Rename', pageType: 'rich' })
    })
    const { page } = (await createRes.json()) as { page: Page }

    // Update title.
    const updateRes = await fetch(`${API()}/api/pages/${page.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed Page' })
    })
    expect(updateRes.status).toBe(200)
    const updated = (await updateRes.json()) as { page: Page }
    expect(updated.page.title).toBe('Renamed Page')
  })

  it('duplicates a page via API', async () => {
    const createRes = await fetch(`${API()}/api/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'To Duplicate', pageType: 'html' })
    })
    const { page } = (await createRes.json()) as { page: Page }

    const dupRes = await fetch(`${API()}/api/pages/${page.id}/duplicate`, {
      method: 'POST'
    })
    expect(dupRes.status).toBe(201)
    const duped = (await dupRes.json()) as { page: Page }
    expect(duped.page.id).not.toBe(page.id)
    expect(duped.page.title).toContain('To Duplicate')
  })

  it('deletes a page via API and clears selection', async () => {
    const createRes = await fetch(`${API()}/api/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'To Delete', pageType: 'rich' })
    })
    const { page } = (await createRes.json()) as { page: Page }

    const delRes = await fetch(`${API()}/api/pages/${page.id}`, {
      method: 'DELETE'
    })
    expect(delRes.status).toBe(200)

    // Verify deleted page is not in the list.
    const listRes = await fetch(`${API()}/api/pages`)
    const { pages } = (await listRes.json()) as { pages: Page[] }
    const found = pages.find((p) => p.id === page.id)
    expect(found).toBeUndefined()
  })

  it('search returns filtered results', async () => {
    // Create a uniquely-named page.
    await fetch(`${API()}/api/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Searchable Unicorn Test', pageType: 'rich' })
    })

    const res = await fetch(`${API()}/api/pages?q=Unicorn`)
    expect(res.status).toBe(200)
    const { pages } = (await res.json()) as { pages: Page[] }
    expect(pages.some((p) => p.title.includes('Unicorn'))).toBe(true)
  })
})

describe('HTML-page content API validation', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>
  let serverPort: number

  beforeAll(async () => {
    tempDir = makeTempDir()
    db = initDatabase(tempDir)
    await runMigrations(db)

    const server = Bun.serve({
      fetch: app.fetch,
      port: 0,
      hostname: '127.0.0.1'
    })
    serverPort = server.port as number
  })

  afterAll(async () => {
    await closeDatabase()
    cleanup(tempDir)
  })

  const API = () => `http://127.0.0.1:${serverPort}`

  async function createHtmlPage(content?: string): Promise<{ status: number; page?: Page }> {
    const payload: Record<string, unknown> = { title: `HTML API ${Date.now()}`, pageType: 'html' }
    if (content !== undefined) {
      payload.content = content
    }
    const res = await fetch(`${API()}/api/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const body = (await res.json()) as { page?: Page }
    return { status: res.status, page: body.page }
  }

  it('creates an html page without content as the canonical empty document', async () => {
    const { status, page } = await createHtmlPage()
    expect(status).toBe(201)
    expect(page?.pageType).toBe('html')
    expect(page?.content).toBe('{"version":1,"html":"","css":"","javascript":""}')
  })

  it('rejects malformed non-empty html content with the structured error format', async () => {
    const { status } = await createHtmlPage('<div>not json</div>')
    expect(status).toBe(400)
  })

  it('creates and reloads populated canonical html content verbatim', async () => {
    const canonical = '{"version":1,"html":"<p>round trip</p>","css":"p{}","javascript":""}'
    const { status, page } = await createHtmlPage(canonical)
    expect(status).toBe(201)

    const getRes = await fetch(`${API()}/api/pages/${page!.id}`)
    expect(getRes.status).toBe(200)
    const fetched = (await getRes.json()) as { page: Page }
    expect(fetched.page.content).toBe(canonical)
  })

  it('rejects invalid html content on update with a 400', async () => {
    const { page } = await createHtmlPage()
    const res = await fetch(`${API()}/api/pages/${page!.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'not canonical json' })
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })

  it('accepts valid canonical html content on update', async () => {
    const { page } = await createHtmlPage()
    const next = '{"version":1,"html":"<i>ok</i>","css":"","javascript":""}'
    const res = await fetch(`${API()}/api/pages/${page!.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: next })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { page: Page }
    expect(body.page.content).toBe(next)
  })

  it('rejects page-type conversion explicitly', async () => {
    const { page } = await createHtmlPage()
    const res = await fetch(`${API()}/api/pages/${page!.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed', pageType: 'rich' })
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Page type conversion')
  })

  it('returns 413 for oversized request bodies before parsing', async () => {
    const oversized = JSON.stringify({
      title: 'Too Big',
      pageType: 'html',
      content: `{"version":1,"html":"${'a'.repeat(5 * 1024 * 1024)}","css":"","javascript":""}`
    })
    const res = await fetch(`${API()}/api/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oversized
    })
    expect(res.status).toBe(413)
  })

  it('returns 400 for malformed JSON bodies', async () => {
    const res = await fetch(`${API()}/api/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json'
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Invalid JSON')
  })
})
