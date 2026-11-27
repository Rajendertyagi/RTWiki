import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AppDependencies, createApp } from '../../src/server/app.js'
import { insertAttachment } from '../../src/server/attachments/attachment-repository.js'
import { closeDatabase, initDatabase } from '../../src/server/database/index.js'
import { runMigrations } from '../../src/server/database/migrations.js'
import type { Logger } from '../../src/server/logging/index.js'
import type * as repo from '../../src/server/repositories/page-repository.js'
import * as service from '../../src/server/services/page-service.js'
import { ShutdownCoordinator } from '../../src/server/shutdown-coordinator.js'
import type { PageType } from '../../src/shared/contracts/pages.js'

/**
 * Isolated fixture for the Phase 1 recovery behaviour tests.
 *
 * Every fixture owns a fresh temp data directory and a fresh database
 * connection. `initDatabase` caches its path process-wide, so a fixture must be
 * torn down (which calls `closeDatabase`, clearing that cache) before the next
 * one is set up. Tests therefore use `beforeEach`/`afterEach`, never a shared
 * singleton database.
 */

const BASE = 'http://localhost'

export interface JsonResult<T> {
  status: number
  body: T
}

export interface PageOptions {
  title: string
  content?: string
  pageType?: PageType
  parentId?: string | null
  position?: number
}

export interface AttachmentOptions {
  id?: string
  mimeType?: string
  byteSize?: number
  kind?: 'image' | 'document'
  extractedText?: string | null
  originalName?: string | null
  createdAt?: string
  deletedAt?: string | null
  data?: Uint8Array | null
}

export interface RecoveryFixture {
  tempDir: string
  db: ReturnType<typeof initDatabase>
  app: ReturnType<typeof createApp>
  /** Creates a page through the service write path, so revisions/links are real. */
  page(options: PageOptions): ReturnType<typeof repo.createPage>
  /** Inserts an attachment row directly, for retention fixtures. */
  attachment(options?: AttachmentOptions): string
  /** JSON request against the in-process app, with the required media type. */
  json<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<JsonResult<T>>
  /** Raw request, for attachment bytes and other non-JSON responses. */
  request(path: string, init?: RequestInit): Promise<Response>
}

function silentLogger(): Logger {
  return {
    info() {},
    warn() {},
    error() {},
    async flush() {},
    async close() {}
  }
}

export async function setupRecoveryFixture(): Promise<RecoveryFixture> {
  const tempDir = join(
    tmpdir(),
    `rtwiki-recovery-behaviour-${Date.now()}-${randomUUID().slice(0, 8)}`
  )
  mkdirSync(tempDir, { recursive: true })
  const db = initDatabase(tempDir)
  await runMigrations(db)

  const deps: AppDependencies = {
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
    logger: silentLogger(),
    frontendDistDir: '',
    debugEventSink: { append() {} },
    host: '127.0.0.1',
    dataDir: tempDir
  }
  const app = createApp(deps)

  const page = (options: PageOptions): ReturnType<typeof repo.createPage> =>
    service.createPage(db, {
      title: options.title,
      pageType: options.pageType ?? 'rich',
      content: options.content ?? '',
      parentId: options.parentId ?? null
    })

  const attachment = (options: AttachmentOptions = {}): string => {
    const id = options.id ?? randomUUID()
    insertAttachment(db, {
      id,
      mimeType: options.mimeType ?? 'image/png',
      byteSize: options.byteSize ?? 4,
      kind: options.kind ?? 'image',
      extractedText: options.extractedText ?? null,
      originalName: options.originalName ?? 'fixture.png',
      checksum: null,
      data: options.data === undefined ? new Uint8Array([1, 2, 3, 4]) : options.data,
      deletedAt: options.deletedAt ?? null
    })
    // `insertAttachment` owns the creation timestamp; retention fixtures need
    // to backdate it, so that is a separate explicit write.
    if (options.createdAt !== undefined) {
      db.run('UPDATE attachments SET created_at = ? WHERE id = ?', [options.createdAt, id])
    }
    return id
  }

  const request = async (path: string, init?: RequestInit): Promise<Response> =>
    await app.request(`${BASE}${path}`, init)

  const json = async <T>(method: string, path: string, body?: unknown): Promise<JsonResult<T>> => {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    const response = await request(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    return { status: response.status, body: (await response.json()) as T }
  }

  return { tempDir, db, app, page, attachment, json, request }
}

export async function teardownRecoveryFixture(fixture: RecoveryFixture): Promise<void> {
  await closeDatabase()
  rmSync(fixture.tempDir, { recursive: true, force: true })
}

/** A canonical Rich Note paragraph carrying readable text. */
export function richParagraph(text: string): string {
  return JSON.stringify([
    {
      type: 'paragraph',
      content: [{ type: 'text', text, styles: {} }]
    }
  ])
}

/** A canonical Rich Note paragraph with an internal link to `targetId`. */
export function richLink(targetId: string, label = 'linked note'): string {
  return JSON.stringify([
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'see ', styles: {} },
        {
          type: 'link',
          href: `#/page/${targetId}`,
          content: [{ type: 'text', text: label, styles: {} }]
        }
      ]
    }
  ])
}

/** A canonical Rich Note paragraph referencing an attachment URL. */
export function richAttachment(attachmentId: string, text: string): string {
  return JSON.stringify([
    {
      type: 'paragraph',
      content: [
        { type: 'text', text, styles: {} },
        { type: 'text', text: `/api/attachments/${attachmentId}`, styles: {} }
      ]
    }
  ])
}
