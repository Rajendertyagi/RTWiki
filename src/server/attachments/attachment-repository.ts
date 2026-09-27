import type { Database } from 'bun:sqlite'
import type { ImageInspection } from './image-detect.js'

/**
 * Catalogue of uploaded images, and the bytes themselves (ADR-014).
 *
 * The row is the authority: `id` is what the browser names, and `mime_type` is
 * the only type ever served. Both are ours - neither is a value the uploader
 * supplied.
 *
 * There is deliberately no filename. Images used to be files under
 * `data/attachments/`, which meant writing a file and inserting a row were two
 * separate steps that could disagree; here the bytes and their metadata are one
 * row, so that state cannot be reached.
 */
export interface AttachmentRecord {
  id: string
  mimeType: string
  byteSize: number
  originalName: string | null
  checksum: string | null
  createdAt: string
}

interface AttachmentRow {
  id: string
  mime_type: string
  byte_size: number
  original_name: string | null
  checksum: string | null
  created_at: string
}

function toRecord(row: AttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    originalName: row.original_name,
    checksum: row.checksum,
    createdAt: row.created_at
  }
}

/** An attachment's metadata without its bytes, for listings. */
export type AttachmentSummary = AttachmentRecord

export function insertAttachment(
  db: Database,
  record: Omit<AttachmentRecord, 'createdAt'> & { data: Uint8Array }
): AttachmentRecord {
  // The bytes and the metadata go in as one statement, so an attachment can
  // never exist as one without the other.
  db.run(
    `INSERT INTO attachments (id, mime_type, byte_size, original_name, checksum, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [record.id, record.mimeType, record.byteSize, record.originalName, record.checksum, record.data]
  )
  const stored = getAttachment(db, record.id)
  if (!stored) throw new Error('Attachment row missing immediately after insert')
  return stored
}

export function getAttachment(db: Database, id: string): AttachmentRecord | null {
  const row = db
    .query(
      'SELECT id, mime_type, byte_size, original_name, checksum, created_at FROM attachments WHERE id = ?'
    )
    .get(id) as AttachmentRow | null
  return row ? toRecord(row) : null
}

export function listAttachments(db: Database): AttachmentSummary[] {
  const rows = db
    .query(
      'SELECT id, mime_type, byte_size, original_name, checksum, created_at FROM attachments ORDER BY created_at DESC'
    )
    .all() as AttachmentRow[]
  return rows.map(toRecord)
}

export function deleteAttachment(db: Database, id: string): boolean {
  const result = db.run('DELETE FROM attachments WHERE id = ?', [id])
  return result.changes > 0
}

/**
 * The size of an attachment's stored bytes, or `null` if there is no such row.
 *
 * A separate query from the read so the response can declare `content-length`
 * before any bytes are produced.
 */
export function getAttachmentByteSize(db: Database, id: string): number | null {
  const row = db.query('SELECT length(data) AS size FROM attachments WHERE id = ?').get(id) as {
    size: number | null
  } | null
  return row?.size ?? null
}

/**
 * How many bytes are read from the blob per chunk when serving.
 *
 * A measured choice, not a round number (ADR-014 §4). Reading a blob in slices
 * is markedly slower than one read, because each slice re-walks the BLOB's
 * overflow pages: for an 8 MB blob, one read took 10 ms, 512 KB slices 114 ms,
 * and 256 KB slices 188 ms. Chunking is still the right shape, because it
 * bounds memory, but 512 KB is where the per-slice overhead stops dominating.
 */
export const BLOB_STREAM_CHUNK_BYTES = 512 * 1024

/**
 * Serves an attachment's bytes as a stream, without holding the whole image.
 *
 * `bun:sqlite` has no incremental BLOB handle, so a slice is read with
 * `substr()`. The trade is deliberate: streaming costs roughly ten times a
 * single read, and in exchange an in-flight response holds one chunk rather than
 * the entire image, so a note with several large images does not multiply its
 * memory use by their total size.
 *
 * Returns `null` when there is no such attachment, so the caller can answer 404
 * without having started a response.
 */
export function streamAttachmentBytes(db: Database, id: string): ReadableStream<Uint8Array> | null {
  const size = getAttachmentByteSize(db, id)
  if (size === null) return null

  let offset = 1 // substr is 1-based
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset > size) {
        controller.close()
        return
      }
      const row = db
        .query('SELECT substr(data, ?, ?) AS chunk FROM attachments WHERE id = ?')
        .get(offset, BLOB_STREAM_CHUNK_BYTES, id) as { chunk: Uint8Array | null } | null
      if (!row?.chunk || row.chunk.length === 0) {
        controller.close()
        return
      }
      offset += row.chunk.length
      controller.enqueue(row.chunk)
    }
  })
}

/** What the storage layer decided about an upload. */
export type StoredAttachment =
  | { ok: true; record: AttachmentRecord }
  | { ok: false; reason: 'unsupported_type' | 'svg_not_supported' | 'too_many_pixels' | 'empty' }

/**
 * Decides the stored identity of an upload from its content.
 *
 * Returns the decisions, not the bytes: writing them is the caller's job, so
 * this stays testable without a database and so the rejection paths are
 * exercised directly.
 *
 * `inspection` is the verdict from `inspectImageUpload`, which read the file's
 * own bytes. This function never inspects anything itself - it only records what
 * that verdict decided, so there is exactly one place in the codebase where a
 * file's identity is established.
 *
 * The uploader's filename is recorded for display and nothing else. Since the
 * bytes live in the database there is no path to build, so a request naming
 * `../../../etc/passwd` is simply a string in a column.
 */
export function planStorage(
  bytes: Uint8Array,
  options: {
    id: string
    originalName?: string | null
    checksum?: string | null
    inspection: ImageInspection
  }
): StoredAttachment {
  if (bytes.length === 0) return { ok: false, reason: 'empty' }
  if (!options.inspection.ok) return { ok: false, reason: options.inspection.reason }

  const { format } = options.inspection
  const original = normaliseOriginalName(options.originalName)
  return {
    ok: true,
    record: {
      id: options.id,
      mimeType: format.mime,
      byteSize: bytes.length,
      originalName: original,
      // Computed now rather than left NULL: it is what makes content-addressed
      // deduplication possible later, and it is free while the bytes are in hand.
      checksum: options.checksum ?? checksumOf(bytes),
      createdAt: ''
    }
  }
}

/**
 * A content hash for an upload, used to recognise a repeated image.
 *
 * SHA-256 truncated to 128 bits expressed as hex. The full digest would be
 * larger than the value is worth here: this identifies a file for deduplication,
 * it is not a security boundary, and the stored type is established by
 * inspecting the bytes rather than by trusting a hash.
 */
function checksumOf(bytes: Uint8Array): string {
  const digest = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
  return digest.slice(0, 32)
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
