import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { type AppDependencies, createApp } from '../src/server/app.js'
import { closeDatabase, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { prepareImport } from '../src/server/ingest/ingest-file.js'
import type { IngestDependencies, PreparedImport } from '../src/server/ingest/ingest-types.js'
import { createPreviewStore } from '../src/server/ingest/preview-store.js'
import type { Logger } from '../src/server/logging/index.js'
import { createImportRoutes } from '../src/server/routes/import.js'
import { createPage } from '../src/server/services/page-service.js'
import { ShutdownCoordinator } from '../src/server/shutdown-coordinator.js'

/**
 * Phase 3 — preview/confirm orchestration over real HTTP with the app-wide
 * guards mounted. The assertions are behavioural: preview must not write,
 * cancellation must not write, confirm must commit everything atomically, and
 * the existing single-file route must be untouched.
 */

const BASE = 'http://localhost'

function makeTempDir(): string {
  return join(tmpdir(), `rtwiki-preview-confirm-${Date.now()}-${randomUUID().slice(0, 8)}`)
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
    } as unknown as Logger,
    frontendDistDir: '',
    debugEventSink: { append: () => {} },
    host: '127.0.0.1',
    dataDir: tempDir
  }
}

function mdFile(body: string, name: string): File {
  return new File([body], name, { type: 'text/markdown' })
}

function previewForm(files: File[], extra: Record<string, string> = {}): FormData {
  const form = new FormData()
  for (const file of files) form.append('file', file)
  for (const [key, value] of Object.entries(extra)) form.append(key, value)
  return form
}

function confirmBody(previewId: string, parentId?: string | null): string {
  return JSON.stringify({ previewId, ...(parentId !== undefined ? { parentId } : {}) })
}

function previewIdOf(preview: PreviewResponse): string {
  if (!preview.previewId) throw new Error('Expected a preview id')
  return preview.previewId
}

interface PreviewResponse {
  previewId?: string
  pages?: Array<{
    title: string
    pageType: string
    byteSize: number
    originalName: string
    mimeType: string
    warnings: Array<{ code: string; message: string }>
  }>
  error?: string
  code?: string
}

interface ConfirmResponse {
  pages?: Array<{ id: string; title: string; parentId: string | null }>
  warnings?: Array<{ code: string; message: string }>
  error?: string
  code?: string
}

function counts(db: ReturnType<typeof initDatabase>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const table of ['pages', 'attachments', 'import_sources', 'search_index']) {
    out[table] = (db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
  }
  return out
}

describe('POST /api/import/preview and /api/import/confirm', () => {
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

  it('preview returns a descriptor and writes nothing', async () => {
    const before = counts(db)
    const res = await app.request(`${BASE}/api/import/preview`, {
      method: 'POST',
      body: previewForm([
        mdFile('# One\n\nFirst note.', 'one.md'),
        mdFile('# Two\n\nSecond note.', 'two.md')
      ])
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as PreviewResponse
    expect(body.previewId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.pages?.length).toBe(2)
    expect(body.pages?.[0]?.title).toBe('one')
    expect(body.pages?.[1]?.title).toBe('two')
    expect(body.pages?.[0]?.pageType).toBe('markdown')
    expect(body.pages?.[0]?.byteSize).toBeGreaterThan(0)
    expect(body.pages?.[0]?.originalName).toBe('one.md')
    expect(Array.isArray(body.pages?.[0]?.warnings)).toBe(true)
    expect(counts(db)).toEqual(before)
  })

  it('cancellation (no confirm call) leaves the database untouched', async () => {
    const before = counts(db)
    const res = await app.request(`${BASE}/api/import/preview`, {
      method: 'POST',
      body: previewForm([mdFile('# Cancel me', 'cancel.md')])
    })
    expect(res.status).toBe(200)
    // The client simply drops the previewId and never calls /confirm.
    expect(counts(db)).toEqual(before)
  })

  it('rejects invalid input at preview with the existing error shape and no writes', async () => {
    const before = counts(db)

    const badSource = await app.request(`${BASE}/api/import/preview`, {
      method: 'POST',
      body: previewForm([mdFile('# x', 'x.md')], { source: JSON.stringify({ kind: 'paste' }) })
    })
    expect(badSource.status).toBe(400)
    expect(((await badSource.json()) as PreviewResponse).code).toBe('unsupported_source')

    const empty = await app.request(`${BASE}/api/import/preview`, {
      method: 'POST',
      body: previewForm([mdFile('', 'empty.md')])
    })
    expect(empty.status).toBe(400)
    expect(((await empty.json()) as PreviewResponse).code).toBe('empty')

    const badParent = await app.request(`${BASE}/api/import/preview`, {
      method: 'POST',
      body: previewForm([mdFile('# x', 'x.md')], { parentId: 'not-a-uuid' })
    })
    expect(badParent.status).toBe(400)
    expect(((await badParent.json()) as PreviewResponse).code).toBe('invalid_field')

    const wrongMedia = await app.request(`${BASE}/api/import/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    })
    expect(wrongMedia.status).toBe(415)
    expect(((await wrongMedia.json()) as PreviewResponse).code).toBe('wrong_media_type')

    expect(counts(db)).toEqual(before)
  })

  it('confirm creates every page, attachment, provenance row and parent relationship', async () => {
    const parent = createPage(db, {
      title: 'Parent',
      pageType: 'rich',
      content: '',
      parentId: null
    })
    const before = counts(db)

    const previewRes = await app.request(`${BASE}/api/import/preview`, {
      method: 'POST',
      body: previewForm([mdFile('# A', 'a.md'), mdFile('# B', 'b.md')], { parentId: parent.id })
    })
    expect(previewRes.status).toBe(200)
    const preview = (await previewRes.json()) as PreviewResponse
    expect(counts(db)).toEqual(before)

    const confirmRes = await app.request(`${BASE}/api/import/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: confirmBody(previewIdOf(preview))
    })
    expect(confirmRes.status).toBe(201)
    const confirmed = (await confirmRes.json()) as ConfirmResponse
    expect(confirmed.pages?.length).toBe(2)
    expect(confirmed.pages?.every((page) => page.parentId === parent.id)).toBe(true)

    const after = counts(db)
    expect(after.pages).toBe(before.pages + 2)
    expect(after.attachments).toBe(before.attachments + 2)
    expect(after.import_sources).toBe(before.import_sources + 2)
    expect(after.search_index).toBe(before.search_index + 2)

    const provenance = db
      .query('SELECT page_id, original_name FROM import_sources ORDER BY original_name')
      .all() as Array<{ page_id: string; original_name: string }>
    expect(provenance.map((row) => row.original_name)).toEqual(['a.md', 'b.md'])
    expect(
      provenance.every((row) => confirmed.pages?.some((page) => page.id === row.page_id))
    ).toBe(true)
  })

  it('confirm honours an explicit parentId override', async () => {
    const parent = createPage(db, {
      title: 'Override parent',
      pageType: 'rich',
      content: '',
      parentId: null
    })
    const previewRes = await app.request(`${BASE}/api/import/preview`, {
      method: 'POST',
      body: previewForm([mdFile('# Override', 'override.md')])
    })
    const preview = (await previewRes.json()) as PreviewResponse

    const confirmRes = await app.request(`${BASE}/api/import/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: confirmBody(previewIdOf(preview), parent.id)
    })
    expect(confirmRes.status).toBe(201)
    const confirmed = (await confirmRes.json()) as ConfirmResponse
    expect(confirmed.pages?.[0]?.parentId).toBe(parent.id)
  })

  it('rolls back completely when the parent becomes invalid between preview and confirm', async () => {
    const parent = createPage(db, {
      title: 'Doomed parent',
      pageType: 'rich',
      content: '',
      parentId: null
    })
    const before = counts(db)

    const previewRes = await app.request(`${BASE}/api/import/preview`, {
      method: 'POST',
      body: previewForm([mdFile('# R1', 'r1.md'), mdFile('# R2', 'r2.md')], { parentId: parent.id })
    })
    const preview = (await previewRes.json()) as PreviewResponse
    expect(counts(db)).toEqual(before)

    // The parent disappears after preview. `createPageCore` validates it inside
    // the confirm transaction, so the whole batch must fail and roll back.
    db.run('UPDATE pages SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), parent.id])

    const confirmRes = await app.request(`${BASE}/api/import/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: confirmBody(previewIdOf(preview))
    })
    expect(confirmRes.status).toBe(404)
    expect(((await confirmRes.json()) as ConfirmResponse).code).toBe('parent_not_found')
    expect(counts(db)).toEqual(before)
  })

  it('refuses an unknown or reused preview id without writing', async () => {
    const before = counts(db)
    const unknown = await app.request(`${BASE}/api/import/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: confirmBody(randomUUID())
    })
    expect(unknown.status).toBe(400)
    expect(((await unknown.json()) as ConfirmResponse).code).toBe('invalid_field')
    expect(counts(db)).toEqual(before)

    const previewRes = await app.request(`${BASE}/api/import/preview`, {
      method: 'POST',
      body: previewForm([mdFile('# Once', 'once.md')])
    })
    const preview = (await previewRes.json()) as PreviewResponse
    const first = await app.request(`${BASE}/api/import/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: confirmBody(previewIdOf(preview))
    })
    expect(first.status).toBe(201)
    const afterFirst = counts(db)

    const second = await app.request(`${BASE}/api/import/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: confirmBody(previewIdOf(preview))
    })
    expect(second.status).toBe(400)
    expect(counts(db)).toEqual(afterFirst)
  })

  it('revalidates the descriptor and rolls back a bad one before any write', async () => {
    // Inject a descriptor whose title violates CreatePageSchema. This cannot be
    // produced through /preview (the field schema rejects it there), so it
    // exercises the confirm-time revalidation defence directly.
    const store = createPreviewStore()
    const deps: IngestDependencies = { logger: {} as Logger }
    const prepared = await prepareImport(
      {
        sourceKind: 'file',
        bytes: new TextEncoder().encode('# Bad\n\nbody'),
        reportedType: 'text/markdown',
        originalName: 'bad.md',
        createPage: true
      },
      deps
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok || prepared.page === null) return
    const bad: PreparedImport = {
      ...prepared,
      page: { ...prepared.page, title: '' }
    }
    const previewId = store.store([bad])

    const routes = createImportRoutes(() => db, {}, store)
    const direct = new Hono().route('/api/import', routes)
    const before = counts(db)
    const res = await direct.request(`${BASE}/api/import/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: confirmBody(previewId)
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ConfirmResponse).code).toBe('invalid_field')
    expect(counts(db)).toEqual(before)
  })
})
