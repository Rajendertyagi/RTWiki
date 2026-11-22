import type { Database } from 'bun:sqlite'
import type { ImportSourceKind } from '../../shared/schemas/import.js'

/**
 * Import provenance: a snapshot of the import event, stored in its own table
 * with no foreign key to `pages` (ADR-024 §4). The row survives deletion of the
 * page it describes, which is the point — provenance describes what happened,
 * not the page that happened to be created.
 */

export interface ImportSourceRecord {
  readonly id: string
  readonly pageId: string
  readonly attachmentId: string
  readonly sourceKind: ImportSourceKind
  readonly originalName: string
  readonly byteSize: number
  readonly checksum: string
  readonly mimeType: string
  readonly createdAt: string
}

interface ImportSourceRow {
  id: string
  page_id: string
  attachment_id: string
  source_kind: string
  original_name: string
  byte_size: number
  checksum: string
  mime_type: string
  created_at: string
}

const COLUMNS =
  'id, page_id, attachment_id, source_kind, original_name, byte_size, checksum, mime_type, created_at'

function toRecord(row: ImportSourceRow): ImportSourceRecord {
  return {
    id: row.id,
    pageId: row.page_id,
    attachmentId: row.attachment_id,
    sourceKind: row.source_kind as ImportSourceKind,
    originalName: row.original_name,
    byteSize: row.byte_size,
    checksum: row.checksum,
    mimeType: row.mime_type,
    createdAt: row.created_at
  }
}

/** Writes one provenance snapshot. All values are bound parameters. */
export function insertImportSource(
  db: Database,
  record: Omit<ImportSourceRecord, 'createdAt'>
): ImportSourceRecord {
  db.run(
    `INSERT INTO import_sources
       (id, page_id, attachment_id, source_kind, original_name, byte_size, checksum, mime_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.pageId,
      record.attachmentId,
      record.sourceKind,
      record.originalName,
      record.byteSize,
      record.checksum,
      record.mimeType
    ]
  )
  const stored = getImportSource(db, record.id)
  if (!stored) throw new Error('Import source row missing immediately after insert')
  return stored
}

/** Reads a snapshot by its own id. */
export function getImportSource(db: Database, id: string): ImportSourceRecord | null {
  const row = db
    .query(`SELECT ${COLUMNS} FROM import_sources WHERE id = ?`)
    .get(id) as ImportSourceRow | null
  return row ? toRecord(row) : null
}

/** Reads the snapshot describing the import that created a page, if any. */
export function getImportSourceByPage(db: Database, pageId: string): ImportSourceRecord | null {
  const row = db
    .query(`SELECT ${COLUMNS} FROM import_sources WHERE page_id = ?`)
    .get(pageId) as ImportSourceRow | null
  return row ? toRecord(row) : null
}
