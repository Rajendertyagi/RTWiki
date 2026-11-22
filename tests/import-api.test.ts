import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AppDependencies, createApp } from '../src/server/app.js'
import { closeDatabase, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { ShutdownCoordinator } from '../src/server/shutdown-coordinator.js'
import { PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES } from '../src/shared/constants/index.js'
import { parseMarkdownPageContent } from '../src/shared/schemas/markdown-content.js'

/**
 * `POST /api/import` over real HTTP, with the app-wide guards mounted.
 *
 * The route is a thin consumer of the one ingest pipeline, so these tests check
 * the envelope it owns — media type, field validation, structured refusals,
 * cross-origin and Host guards, cache headers — and that a real Markdown file
 * lands in `pages.content` with its line breaks intact.
 */

const BASE = 'http://localhost'
const FENCED = '# H\n\n- a\n- b\n\n```js\ncode\n```'

function makeTempDir(): string {
  return join(tmpdir(), `rtwiki-import-api-${Date.now()}-${randomUUID().slice(0, 8)}`)
}

function makeDeps(tempDir: string): AppDependencies {
  const db = initDatabase(tempDir)
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
    debugEventSink: { append: () => {} },
    host: '127.0.0.1',
    dataDir: tempDir
  }
}

function mdFile(body = '# Note\n\nBody', name = 'note.md'): File {
  return new File([body], name, { type: 'text/markdown' })
}

function formWith(file: File, extra: Record<string, string> = {}): FormData {
  const form = new FormData()
  form.append('file', file)
  for (const [key, value] of Object.entries(extra)) form.append(key, value)
  return form
}

interface ImportResponse {
  page: { id: string; title: string; pageType: string; content: string }
  attachment: { id: string; mimeType: string; byteSize: number }
  provenance: { id: string; pageId: string; sourceKind: string; originalName: string }
  warnings: Array<{ code: string; message: string }>
  error?: string
  code?: string
}

describe('POST /api/import', () => {
  let tempDir: string
  let app: ReturnType<typeof createApp>
  let db: ReturnType<typeof initDatabase>

  beforeAll(async () => {
    tempDir = makeTempDir()
    mkdirSync(tempDir, { recursive: true })
    const deps = makeDeps(tempDir)
    db = deps.getDb()
    await runMigrations(db)
    app = createApp(deps)
  })

  afterAll(async () => {
    await closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns 201 with page, attachment, provenance and warnings', async () => {
    const res = await app.request(`${BASE}/api/import`, {
      method: 'POST',
      body: formWith(mdFile('# Photosynthesis\n\nLight becomes sugar.'))
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as ImportResponse
    expect(body.page).toBeDefined()
    expect(body.attachment).toBeDefined()
    expect(body.provenance).toBeDefined()
    expect(Array.isArray(body.warnings)).toBe(true)
    expect(body.page.title).toBe('note')
    expect(body.page.pageType).toBe('markdown')
    expect(body.provenance.sourceKind).toBe('file')
    expect(body.provenance.originalName).toBe('note.md')
    expect(body.provenance.pageId).toBe(body.page.id)
    expect(body.attachment.mimeType).toBe('text/markdown')

    // The page is real, not just a response shape.
    const stored = db.query('SELECT content FROM pages WHERE id = ?').get(body.page.id) as {
      content: string
    }
    expect(stored.content).toBe(body.page.content)
  })

  it('refuses a non-multipart body with 415 wrong_media_type', async () => {
    const res = await app.request(`${BASE}/api/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: 'not a file' })
    })
    expect(res.status).toBe(415)
    const body = (await res.json()) as ImportResponse
    expect(body.code).toBe('wrong_media_type')
    expect(body.error).toBeTruthy()
  })

  it('refuses an oversized body with 413 before reading it', async () => {
    // bodyLimit checks the declared Content-Length first, so an honest
    // oversized request is refused without buffering 100 MB in the test.
    const res = await app.request(`${BASE}/api/import`, {
      method: 'POST',
      headers: { 'content-length': String(PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES + 1) },
      body: formWith(mdFile())
    })
    expect(res.status).toBe(413)
    const body = (await res.json()) as ImportResponse
    expect(body.code).toBe('too_large')
  })

  it.each(['paste', 'api'])('refuses source.kind %s with 400 unsupported_source', async (kind) => {
    const res = await app.request(`${BASE}/api/import`, {
      method: 'POST',
      body: formWith(mdFile(), { source: JSON.stringify({ kind }) })
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as ImportResponse
    expect(body.code).toBe('unsupported_source')
  })

  it('refuses a missing parent with 404 parent_not_found', async () => {
    const res = await app.request(`${BASE}/api/import`, {
      method: 'POST',
      body: formWith(mdFile(), { parentId: '00000000-0000-0000-0000-000000000000' })
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as ImportResponse
    expect(body.code).toBe('parent_not_found')
  })

  it('marks the response no-store', async () => {
    const res = await app.request(`${BASE}/api/import`, {
      method: 'POST',
      body: formWith(mdFile())
    })
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('refuses a cross-origin POST with 403', async () => {
    const res = await app.fetch(
      new Request(`${BASE}/api/import`, {
        method: 'POST',
        headers: { Origin: 'https://attacker.example' },
        body: formWith(mdFile())
      })
    )
    // The app-wide guard answers before the route; it now emits the same
    // structured `forbidden` code so the contract holds end-to-end.
    expect(res.status).toBe(403)
    const body = (await res.json()) as ImportResponse
    expect(body.code).toBe('forbidden')
  })

  it('refuses a rebound Host with 403', async () => {
    const res = await app.fetch(
      new Request(`${BASE}/api/import`, {
        method: 'POST',
        headers: { Host: 'attacker.example' },
        body: formWith(mdFile())
      })
    )
    expect(res.status).toBe(403)
  })

  it('preserves a fenced code block byte-for-byte in page.content', async () => {
    const res = await app.request(`${BASE}/api/import`, {
      method: 'POST',
      body: formWith(mdFile(FENCED, 'fenced.md'))
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as ImportResponse
    const parsed = parseMarkdownPageContent(body.page.content)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.markdown).toBe(FENCED)
  })

  it('refuses signature-less text past the character limit instead of truncating it', async () => {
    // The old client refused this before reading; the old detector silently
    // sliced it to 100,000 chars. The one ingest path must refuse it and lose
    // nothing (AGENTS.md §4).
    const overLimit = `# Long\n\n${'x'.repeat(100_001)}`
    const res = await app.request(`${BASE}/api/import`, {
      method: 'POST',
      body: formWith(mdFile(overLimit, 'huge.md'))
    })
    expect(res.status).toBe(413)
    const body = (await res.json()) as ImportResponse
    expect(body.code).toBe('text_too_long')
    expect(body.error).toContain('100,000')

    const pages = db.query('SELECT count(*) AS n FROM pages WHERE title = ?').get('huge') as {
      n: number
    }
    expect(pages.n).toBe(0)
  })
})
