import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AppDependencies, createApp } from '../src/server/app.js'
import { closeDatabase, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { ShutdownCoordinator } from '../src/server/shutdown-coordinator.js'
import { parseHtmlContent } from '../src/shared/schemas/html-content'
import { parseMarkdownPageContent } from '../src/shared/schemas/markdown-content'
import { parseRichContent } from '../src/shared/schemas/rich-content'
import { parseVisualPageContent } from '../src/shared/schemas/visual-page-content'

const ORIGIN = 'http://localhost'

function makeTempDir(): string {
  const dir = join(tmpdir(), `rtwiki-batch-${Date.now()}-${randomUUID().slice(0, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function makeDeps(tempDir: string, db: ReturnType<typeof initDatabase>): AppDependencies {
  return {
    coordinator: new ShutdownCoordinator({
      stopGracefully: async () => {},
      closeDatabase: async () => {},
      logInfo: () => {},
      logWarn: () => {},
      logError: () => {},
      closeLogger: async () => {}
    }),
    token: randomUUID(),
    getDb: () => db,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      close: async () => {}
    } as unknown as import('../src/server/logging/index.js').Logger,
    frontendDistDir: '',
    dataDir: tempDir,
    debugEventSink: { append: () => {} },
    host: '127.0.0.1'
  }
}

interface Page {
  id: string
  title: string
  pageType: string
  content: string
}

let tempDir: string
let app: ReturnType<typeof createApp>

async function postJson(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(body)
  })
}

async function totalPages(): Promise<number> {
  const res = await app.request('/api/pages?limit=100')
  const body = (await res.json()) as { total: number }
  return body.total
}

describe('page creation and atomic batch creation through the API', () => {
  beforeAll(async () => {
    tempDir = makeTempDir()
    const db = initDatabase(tempDir)
    await runMigrations(db)
    app = createApp(makeDeps(tempDir, db))
  })

  afterAll(async () => {
    await closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates and reads back all four canonical page types', async () => {
    const cases: Array<{ title: string; pageType: string; content: string }> = [
      { title: 'Rich', pageType: 'rich', content: '[]' },
      {
        title: 'HTML',
        pageType: 'html',
        content: '{"version":1,"html":"<div>hi</div>","css":"","javascript":""}'
      },
      { title: 'Diagram', pageType: 'diagram', content: '' },
      { title: 'Markdown', pageType: 'markdown', content: '' }
    ]
    for (const item of cases) {
      const created = await postJson('/api/pages', item)
      expect(created.status).toBe(201)
      const { page } = (await created.json()) as { page: Page }
      expect(page.pageType).toBe(item.pageType)
      expect(page.title).toBe(item.title)

      const fetched = await app.request(`/api/pages/${page.id}`)
      expect(fetched.status).toBe(200)
      const readBack = ((await fetched.json()) as { page: Page }).page
      expect(readBack.id).toBe(page.id)
      expect(readBack.content).toBe(page.content)

      // The stored content is parseable by its own canonical parser, which is
      // what the editor uses to render it.
      const parsed =
        page.pageType === 'rich'
          ? parseRichContent(page.content)
          : page.pageType === 'html'
            ? parseHtmlContent(page.content)
            : page.pageType === 'diagram'
              ? parseVisualPageContent(page.content)
              : parseMarkdownPageContent(page.content)
      expect(parsed.ok).toBe(true)
    }
  })

  it('creates every batch item when all are valid', async () => {
    const before = await totalPages()
    const res = await postJson('/api/pages/batch', {
      pages: [
        { title: 'Batch A', pageType: 'rich', content: '[]' },
        { title: 'Batch B', pageType: 'markdown', content: '' }
      ]
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { pages: Page[] }
    expect(body.pages).toHaveLength(2)
    expect(body.pages.map((p) => p.title)).toEqual(['Batch A', 'Batch B'])
    expect(await totalPages()).toBe(before + 2)
  })

  it('rolls the whole batch back when an item fails page-type validation', async () => {
    const before = await totalPages()
    const res = await postJson('/api/pages/batch', {
      pages: [
        { title: 'Would-be created', pageType: 'rich', content: '[]' },
        // Passes the shared Zod schema (a string) but fails the Rich Note
        // structural validator inside createPageCore.
        { title: 'Invalid', pageType: 'rich', content: 'not-a-blocknote-document' }
      ]
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBeTruthy()
    expect(await totalPages()).toBe(before)
  })

  it('rejects a malformed item with RTWiki’s error shape and creates nothing', async () => {
    const before = await totalPages()
    const res = await postJson('/api/pages/batch', {
      pages: [
        { title: 'Valid', pageType: 'rich', content: '[]' },
        { title: '', pageType: 'rich', content: '[]' }
      ]
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string; success?: boolean }
    expect(typeof body.error).toBe('string')
    expect(body.success).toBeUndefined()
    expect(await totalPages()).toBe(before)
  })
})
