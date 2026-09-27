import type { Database } from 'bun:sqlite'
import { detectImageFormat } from '../../shared/attachments/image-formats.js'

/**
 * Catalogue of uploaded images.
 *
 * The row is the authority: `id` is what the browser names, `stored_name` is the
 * only thing that touches the filesystem, and `mime_type` is the only type ever
 * served. All three are ours - none of them is a value the uploader supplied.
 */
export interface AttachmentRecord {
  id: string
  storedName: string
  mimeType: string
  byteSize: number
  originalName: string | null
  checksum: string | null
  createdAt: string
}

interface AttachmentRow {
  id: string
  stored_name: string
  mime_type: string
  byte_size: number
  original_name: string | null
  checksum: string | null
  created_at: string
}

function toRecord(row: AttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    storedName: row.stored_name,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    originalName: row.original_name,
    checksum: row.checksum,
    createdAt: row.created_at
  }
}

export function insertAttachment(
  db: Database,
  record: Omit<AttachmentRecord, 'createdAt'>
): AttachmentRecord {
  db.run(
    `INSERT INTO attachments (id, stored_name, mime_type, byte_size, original_name, checksum)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.storedName,
      record.mimeType,
      record.byteSize,
      record.originalName,
      record.checksum
    ]
  )
  const stored = getAttachment(db, record.id)
  if (!stored) throw new Error('Attachment row missing immediately after insert')
  return stored
}

export function getAttachment(db: Database, id: string): AttachmentRecord | null {
  const row = db.query('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | null
  return row ? toRecord(row) : null
}

export function listAttachments(db: Database): AttachmentRecord[] {
  const rows = db
    .query('SELECT * FROM attachments ORDER BY created_at DESC')
    .all() as AttachmentRow[]
  return rows.map(toRecord)
}

export function deleteAttachment(db: Database, id: string): boolean {
  const result = db.run('DELETE FROM attachments WHERE id = ?', [id])
  return result.changes > 0
}

/** What the storage layer decided about an upload. */
export type StoredAttachment =
  | { ok: true; record: AttachmentRecord }
  | { ok: false; reason: 'unsupported_type' | 'empty' }

/**
 * Decides the stored identity of an upload from its content.
 *
 * Returns the decisions, not the bytes: writing the file is the caller's job, so
 * this stays testable without a filesystem and so the rejection paths are
 * exercised directly.
 *
 * The uploader's filename never influences `storedName` beyond being recorded for
 * display. A request naming `../../../etc/passwd` produces an ordinary
 * `<uuid>.<ext>` like any other, so there is no traversal to defend against at
 * the point where a filename becomes a path.
 */
export function planStorage(
  bytes: Uint8Array,
  options: { id: string; originalName?: string | null; checksum?: string | null }
): StoredAttachment {
  if (bytes.length === 0) return { ok: false, reason: 'empty' }
  const format = detectImageFormat(bytes)
  if (!format) return { ok: false, reason: 'unsupported_type' }

  const original = normaliseOriginalName(options.originalName)
  return {
    ok: true,
    record: {
      id: options.id,
      storedName: `${options.id}.${format.ext}`,
      mimeType: format.mime,
      byteSize: bytes.length,
      originalName: original,
      checksum: options.checksum ?? null,
      createdAt: ''
    }
  }
}

/** C0 control characters and DEL, none of which belong in a name a human reads. */
function isUnsafeNameChar(code: number): boolean {
  return code <= 0x1f || code === 0x7f
}

/**
 * Cleans an uploader-supplied name down to something safe to store and show.
 *
 * It is data, never a path, so the goal is only to keep it printable and bounded:
 * path separators and control characters are dropped rather than escaped, because
 * there is no legitimate reason for a filename to contain either.
 */
export function normaliseOriginalName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  let cleaned = ''
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0
    if (isUnsafeNameChar(code)) continue
    if (ch === '/' || ch === '\\') continue
    cleaned += ch
  }
  cleaned = cleaned.trim()
  if (cleaned.length === 0) return null
  return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned
}
