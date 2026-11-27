import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { createBackup } from '../src/server/backup/backup-service.js'
import { validateBackupFile } from '../src/server/backup/validation.js'
import { requiredMigrationNames } from '../src/server/database/migrations.js'
import { insertOperationCore } from '../src/server/repositories/page-repository.js'
import { OperationKind, OperationStatus, RecoveryActor } from '../src/shared/schemas/recovery.js'
import {
  type RecoveryFixture,
  richParagraph,
  setupRecoveryFixture,
  teardownRecoveryFixture
} from './helpers/recovery-fixtures.js'

interface ListResponse {
  pages: Array<{ id: string }>
  total: number
}

interface OperationsResponse {
  operations: Array<{
    id: string
    operationKind: string
    targetPageId: string | null
    targetAttachmentId: string | null
    beforeRevisionId: string | null
    afterRevisionId: string | null
    actor: string
    status: string
    createdAt: string
  }>
}

interface ImportResponse {
  page?: { id: string; title: string; pageType: string }
  attachment?: { id: string; mimeType: string; byteSize: number }
  provenance?: { id: string; pageId: string; sourceKind: string; originalName: string }
  warnings?: unknown[]
  error?: string
  code?: string
}

let f: RecoveryFixture

beforeEach(async () => {
  f = await setupRecoveryFixture()
})

afterEach(async () => {
  await teardownRecoveryFixture(f)
})

describe('GET /api/pages pagination', () => {
  it.each(['0', '101', '-1', '1.5', 'abc'])('refuses limit=%s with 400', async (limit) => {
    const result = await f.json('GET', `/api/pages?limit=${limit}`)
    expect(result.status).toBe(400)
  })

  it.each(['-1', '1.5', 'abc'])('refuses offset=%s with 400', async (offset) => {
    const result = await f.json('GET', `/api/pages?offset=${offset}`)
    expect(result.status).toBe(400)
  })

  it('accepts the boundary values and returns a bounded window', async () => {
    for (let i = 0; i < 3; i++) f.page({ title: `Page ${i}` })
    const low = await f.json<ListResponse>('GET', '/api/pages?limit=1&offset=0')
    expect(low.status).toBe(200)
    expect(low.body.pages).toHaveLength(1)
    expect(low.body.total).toBe(3)

    const high = await f.json<ListResponse>('GET', '/api/pages?limit=100&offset=0')
    expect(high.status).toBe(200)
    expect(high.body.pages).toHaveLength(3)
  })
})

describe('POST /api/import post-commit readback', () => {
  it('returns 201 with real page, attachment and provenance records, never a false 500', async () => {
    const form = new FormData()
    form.append('file', new File(['# Readback\n\nBody'], 'readback.md', { type: 'text/markdown' }))
    const response = await f.request('/api/import', { method: 'POST', body: form })
    expect(response.status).toBe(201)

    const body = (await response.json()) as ImportResponse
    expect(body.error).toBeUndefined()
    expect(body.page?.id).toBeTruthy()
    expect(body.attachment?.id).toBeTruthy()
    expect(body.provenance?.id).toBeTruthy()
    expect(body.provenance?.pageId).toBe(body.page?.id)
    expect(body.provenance?.sourceKind).toBe('file')
    expect(body.provenance?.originalName).toBe('readback.md')
    expect(Array.isArray(body.warnings)).toBe(true)

    // The ids are real rows, not the fallback stubs a failed readback would emit.
    const pageId = body.page?.id ?? ''
    const attachmentId = body.attachment?.id ?? ''
    expect(pageId).not.toBe('')
    expect(attachmentId).not.toBe('')
    expect(f.db.query('SELECT 1 FROM pages WHERE id = ?').get(pageId)).not.toBeNull()
    expect(f.db.query('SELECT 1 FROM attachments WHERE id = ?').get(attachmentId)).not.toBeNull()
    expect(f.db.query('SELECT 1 FROM import_sources WHERE page_id = ?').get(pageId)).not.toBeNull()
  })
})

describe('backup validation refuses pre-recovery backups', () => {
  it('rejects a backup missing migration 014 or 015 with schema-missing-migration', async () => {
    const backup = await createBackup(f.tempDir, f.db, 'daily')
    expect(backup.ok).toBe(true)
    if (!backup.ok) return
    expect(validateBackupFile(backup.path).ok).toBe(true)

    // Derived from the migration calls, not a second hand-maintained list.
    const recoveryMigrations = requiredMigrationNames().filter((name) => /^01[45]_/.test(name))
    expect(recoveryMigrations).toHaveLength(2)
    for (const name of recoveryMigrations) {
      const path = join(f.tempDir, `missing-${name}.sqlite`)
      copyFileSync(backup.path, path)
      const candidate = new Database(path)
      try {
        candidate.run('DELETE FROM _migrations WHERE name = ?', [name])
      } finally {
        candidate.close()
      }
      expect(validateBackupFile(path)).toEqual({ ok: false, reason: 'schema-missing-migration' })
    }
  })
})

describe('GET /api/recovery/operations', () => {
  it('exposes only committed recovery operations with shared kinds and actors, newest-first and bounded', async () => {
    const page = f.page({ title: 'Logged', content: richParagraph('LOGGED_NEEDLE') })
    expect(
      (
        await f.json('PATCH', `/api/pages/${page.id}`, {
          title: 'Logged',
          content: richParagraph('LOGGED_NEEDLE_2'),
          version: 1
        })
      ).status
    ).toBe(200)
    expect((await f.json('DELETE', `/api/pages/${page.id}`)).status).toBe(200)
    expect((await f.json('POST', `/api/pages/${page.id}/restore`)).status).toBe(200)

    const response = await f.json<OperationsResponse>('GET', '/api/recovery/operations')
    expect(response.status).toBe(200)
    expect(response.body.operations.length).toBeGreaterThan(0)
    const allowedKinds: string[] = [...OperationKind]
    const statuses: string[] = [...OperationStatus]
    const actors: string[] = [...RecoveryActor]
    for (const operation of response.body.operations) {
      expect(allowedKinds).toContain(operation.operationKind)
      expect(statuses).toContain(operation.status)
      expect(actors).toContain(operation.actor)
    }
    const kinds = new Set(response.body.operations.map((o) => o.operationKind))
    expect(kinds.has('page.update')).toBe(true)
    expect(kinds.has('page.trash')).toBe(true)
    // The normal restore now resolves the pre-delete snapshot itself, so the
    // service records the revision-backed restore kind, not the legacy one.
    expect(kinds.has('page.revision.restore')).toBe(true)

    const timestamps = response.body.operations.map((o) => o.createdAt)
    expect([...timestamps].sort().reverse()).toEqual(timestamps)
  })

  it('returns at most 100 operations, newest-first, when the log is larger', async () => {
    const pageId = randomUUID()
    const base = Date.parse('2026-01-01T00:00:00.000Z')
    for (let i = 0; i < 150; i++) {
      insertOperationCore(f.db, {
        id: randomUUID(),
        operationKind: OperationKind[0],
        targetPageId: pageId,
        targetAttachmentId: null,
        beforeRevisionId: null,
        afterRevisionId: null,
        actor: RecoveryActor[0],
        status: OperationStatus[0],
        createdAt: new Date(base + i * 1000).toISOString()
      })
    }

    const response = await f.json<OperationsResponse>('GET', '/api/recovery/operations')
    expect(response.status).toBe(200)
    expect(response.body.operations).toHaveLength(100)
    const timestamps = response.body.operations.map((o) => o.createdAt)
    expect(timestamps[0]).toBe(new Date(base + 149 * 1000).toISOString())
    expect([...timestamps].sort().reverse()).toEqual(timestamps)
  })
})
