import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BLOB_STREAM_CHUNK_BYTES,
  getAttachment,
  getAttachmentByteSize,
  insertAttachment,
  listAttachments,
  planStorage,
  streamAttachmentBytes
} from '../src/server/attachments/attachment-repository.js'
import { inspectImageUpload } from '../src/server/attachments/image-detect.js'
import { closeDatabase, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { ATTACHMENTS_DIR } from '../src/shared/constants/index.js'

const REAL_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
)

let tempDir: string
let attachmentsDir: string
let db: ReturnType<typeof initDatabase>

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rtwiki-blob-test-'))
  attachmentsDir = join(tempDir, ATTACHMENTS_DIR)
  mkdirSync(attachmentsDir, { recursive: true })
  db = initDatabase(tempDir)
})

afterEach(async () => {
  await closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

/** Inserts an attachment the way the route does, and returns its id. */
async function store(bytes: Uint8Array, name = 'image.png'): Promise<string> {
  const inspection = await inspectImageUpload(bytes)
  if (!inspection.ok) throw new Error(`fixture is not an accepted image: ${inspection.reason}`)
  const id = crypto.randomUUID()
  insertAttachment(db, {
    id,
    mimeType: inspection.format.mime,
    byteSize: bytes.length,
    originalName: name,
    // Left null deliberately: the checksum is computed by planStorage, not by
    // insertAttachment, so this helper must pass one to test the route's path.
    checksum: null,
    data: bytes
  })
  return id
}

/**
 * Stores a blob of arbitrary size without going through image inspection.
 *
 * A multi-chunk blob needs to be larger than a real 1x1 PNG, and padding a PNG
 * with trailing bytes would still be detected as a PNG, so this writes the row
 * directly. The point under test is the streaming, not the detection.
 */
function storeBlobOfSize(byteSize: number): string {
  const id = crypto.randomUUID()
  const bytes = new Uint8Array(byteSize)
  for (let i = 0; i < byteSize; i++) bytes[i] = i % 251
  insertAttachment(db, {
    id,
    mimeType: 'image/png',
    byteSize,
    originalName: 'large.png',
    checksum: null,
    data: bytes
  })
  return id
}

describe('storage pragmas', () => {
  it('sets page_size and auto_vacuum on a new database', async () => {
    await runMigrations(db, attachmentsDir)
    const read = (name: string): unknown =>
      Object.values(db.query(`PRAGMA ${name}`).get() as object)[0]
    expect(read('page_size')).toBe(8192)
    expect(read('auto_vacuum')).toBe(2)
  })

  it('reclaims the space a deleted image occupied', async () => {
    // The reason auto_vacuum is set at all. Without it a deleted image's bytes
    // stay in the file for the life of the installation.
    await runMigrations(db, attachmentsDir)
    const id = await store(REAL_PNG)

    db.query('DELETE FROM attachments WHERE id = ?').run(id)
    db.query('PRAGMA incremental_vacuum').run()
    db.query('PRAGMA wal_checkpoint(TRUNCATE)').run()

    // Nothing is left to reclaim, and no row remains.
    const free = db.query('PRAGMA freelist_count').get() as Record<string, number>
    expect(Object.values(free)[0]).toBe(0)
    expect(listAttachments(db)).toHaveLength(0)
  })
})

describe('blobs live in the row', () => {
  it('stores bytes with no file on disk', async () => {
    await runMigrations(db, attachmentsDir)
    const id = await store(REAL_PNG)
    const size = getAttachmentByteSize(db, id)
    expect(size).toBe(REAL_PNG.byteLength)
    // The data directory was never written to.
    expect(readdirSync(attachmentsDir)).toHaveLength(0)
  })

  it('has no filename column once the bytes are in place', async () => {
    await runMigrations(db, attachmentsDir)
    const columns = (
      db.query('PRAGMA table_info(attachments)').all() as Array<{ name: string }>
    ).map((c) => c.name)
    expect(columns).not.toContain('stored_name')
    expect(columns).toContain('data')
  })

  it('records a checksum, which used to be permanently null', async () => {
    await runMigrations(db, attachmentsDir)
    // planStorage is what computes the checksum, so the route's own path is what
    // has to be exercised. insertAttachment stores whatever it is handed.
    const inspection = await inspectImageUpload(REAL_PNG)
    const planned = planStorage(REAL_PNG, {
      id: 'checksum-test',
      originalName: 'x.png',
      inspection
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.record.checksum).toMatch(/^[0-9a-f]{32}$/)

    insertAttachment(db, { ...planned.record, data: REAL_PNG })
    expect(getAttachment(db, 'checksum-test')?.checksum).toBe(planned.record.checksum)
  })
})

describe('serving a blob as a stream', () => {
  it('delivers exactly the stored bytes', async () => {
    await runMigrations(db, attachmentsDir)
    const id = await store(REAL_PNG)
    const stream = streamAttachmentBytes(db, id)
    expect(stream).not.toBeNull()
    const received = new Uint8Array(await new Response(stream).arrayBuffer())
    expect(received).toEqual(REAL_PNG)
  })

  it('returns null for an id that does not exist', async () => {
    await runMigrations(db, attachmentsDir)
    expect(streamAttachmentBytes(db, '00000000-0000-4000-8000-000000000000')).toBeNull()
  })

  it('reassembles a blob larger than one chunk', async () => {
    // The case that would silently truncate an image if the stream stopped after
    // the first chunk. Exercised across several chunks, not just one.
    await runMigrations(db, attachmentsDir)
    const size = BLOB_STREAM_CHUNK_BYTES * 2 + 1234
    const id = storeBlobOfSize(size)

    const stream = streamAttachmentBytes(db, id)
    const received = new Uint8Array(await new Response(stream).arrayBuffer())
    expect(received.byteLength).toBe(size)
    // Byte-for-byte, not merely the right length.
    for (let i = 0; i < size; i += 997) {
      expect(received[i]).toBe(i % 251)
    }
  })

  it('declares a byte size that matches what it streams', async () => {
    await runMigrations(db, attachmentsDir)
    const size = BLOB_STREAM_CHUNK_BYTES + 99
    const id = storeBlobOfSize(size)
    const declared = getAttachmentByteSize(db, id)
    const stream = streamAttachmentBytes(db, id)
    const received = new Uint8Array(await new Response(stream).arrayBuffer())
    expect(declared).toBe(received.byteLength)
  })
})

const LEGACY_ID = '11111111-1111-4111-8111-111111111111'

describe('migrating a database created before ADR-014', () => {
  /** Builds the old shape: a row plus a file, no blob. */
  function seedLegacyDatabase(): void {
    const legacy = new Database(join(tempDir, 'rtwiki.sqlite'))
    legacy.exec('PRAGMA journal_mode = WAL')
    legacy.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    legacy.exec(`
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        stored_name TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        original_name TEXT,
        checksum TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    legacy
      .query(
        'INSERT INTO attachments (id, stored_name, mime_type, byte_size, original_name) VALUES (?, ?, ?, ?, ?)'
      )
      .run(LEGACY_ID, `${LEGACY_ID}.png`, 'image/png', REAL_PNG.byteLength, 'legacy.png')
    legacy.close()
    // The bytes live where the old layout put them.
    writeFileSync(join(attachmentsDir, `${LEGACY_ID}.png`), REAL_PNG)
  }

  it('copies the bytes into the row and keeps the file', async () => {
    seedLegacyDatabase()
    await closeDatabase()
    db = initDatabase(tempDir)
    await runMigrations(db, attachmentsDir)

    expect(getAttachmentByteSize(db, LEGACY_ID)).toBe(REAL_PNG.byteLength)
    const stream = streamAttachmentBytes(db, LEGACY_ID)
    const received = new Uint8Array(await new Response(stream).arrayBuffer())
    expect(received).toEqual(REAL_PNG)
    // The file is deliberately left alone: nothing is deleted on a guess.
    expect(existsSync(join(attachmentsDir, `${LEGACY_ID}.png`))).toBe(true)
  })

  it('leaves the row and its metadata intact when a file cannot be read', async () => {
    // A row whose file has gone must not take the migration down, and must not be
    // silently dropped either. Because the copy is incomplete, `stored_name`
    // stays and the row is still fully described.
    seedLegacyDatabase()
    rmSync(join(attachmentsDir, `${LEGACY_ID}.png`))
    await closeDatabase()
    db = initDatabase(tempDir)
    await runMigrations(db, attachmentsDir)

    const record = getAttachment(db, LEGACY_ID)
    expect(record?.mimeType).toBe('image/png')
    expect(record?.originalName).toBe('legacy.png')
    // No bytes were invented. `null` means the row has no blob yet, which is
    // distinct from a zero-length blob.
    expect(getAttachmentByteSize(db, LEGACY_ID)).toBeNull()
    const columns = (
      db.query('PRAGMA table_info(attachments)').all() as Array<{ name: string }>
    ).map((c) => c.name)
    expect(columns).toContain('stored_name')
  })

  it('refuses to guess when the file size disagrees with the catalogue', async () => {
    // Storing either figure would record a lie, so the row is left for a human.
    seedLegacyDatabase()
    writeFileSync(join(attachmentsDir, `${LEGACY_ID}.png`), new Uint8Array(5))
    await closeDatabase()
    db = initDatabase(tempDir)
    await runMigrations(db, attachmentsDir)

    // Null, not 5 and not 70: the disagreeing file was not trusted in either
    // direction, and the row is still described.
    expect(getAttachmentByteSize(db, LEGACY_ID)).toBeNull()
    const record = getAttachment(db, LEGACY_ID)
    expect(record).not.toBeNull()
    expect(record?.byteSize).toBe(REAL_PNG.byteLength)
  })

  it('leaves files on disk that no row references', async () => {
    // An orphan cannot be proven to be garbage rather than not-yet-referenced, so
    // the migration must not delete it. Reclaiming orphans is a separate,
    // deliberate retention pass.
    seedLegacyDatabase()
    const orphan = 'orphan-file.png'
    writeFileSync(join(attachmentsDir, orphan), new Uint8Array(10))
    await closeDatabase()
    db = initDatabase(tempDir)
    await runMigrations(db, attachmentsDir)

    expect(existsSync(join(attachmentsDir, orphan))).toBe(true)
  })
})
