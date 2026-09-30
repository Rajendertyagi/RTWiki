import type { Database } from 'bun:sqlite'

/** What an attachment holds. Derived from the stored type, and stored too. */
export type AttachmentKind = 'image' | 'document'

/**
 * Catalogue of uploaded files and their bytes (ADR-014, ADR-015).
 *
 * The row is the authority: `id` is what the browser names, and `mime_type` is
 * the only type ever served. Both are ours - neither is a value the uploader
 * supplied.
 *
 * There is deliberately no filename. Images used to be files under
 * `data/attachments/`, which meant writing a file and inserting a row were two
 * separate steps that could disagree; here the bytes and their metadata are one
 * row, so that state cannot be reached.
 *
 * Images and documents share this table, and so share storage, the upload
 * endpoint and the streaming path. `kind` is what tells them apart.
 */
export interface AttachmentRecord {
  id: string
  mimeType: string
  byteSize: number
  kind: AttachmentKind
  /** Readable text extracted from a document, so its content is searchable. */
  extractedText: string | null
  originalName: string | null
  checksum: string | null
  createdAt: string
}

interface AttachmentRow {
  id: string
  mime_type: string
  byte_size: number
  kind: string
  extracted_text: string | null
  original_name: string | null
  checksum: string | null
  created_at: string
}

/**
 * The columns a metadata read needs.
 *
 * Deliberately excludes `data`, so listing or fetching an attachment's details
 * never pulls a 40 MB document into memory to read its filename.
 */
const METADATA_COLUMNS =
  'id, mime_type, byte_size, kind, extracted_text, original_name, checksum, created_at'

function toRecord(row: AttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    kind: row.kind === 'document' ? 'document' : 'image',
    extractedText: row.extracted_text,
    originalName: row.original_name,
    checksum: row.checksum,
    createdAt: row.created_at
  }
}

/** An attachment's metadata without its bytes, for listings. */
export type AttachmentSummary = AttachmentRecord

export function insertAttachment(
  db: Database,
  record: Omit<AttachmentRecord, 'createdAt'> & { data: Uint8Array | null }
): AttachmentRecord {
  /*
   * The bytes and the metadata go in as one statement, so an attachment can never exist
   * as one without the other.
   *
   * `data` is null only for a **signature-less** document (`.txt`, `.md`, `.html`),
   * whose text is stored and whose bytes are neither served nor kept — they could never
   * be identified, so the serving path refused them anyway, and holding them only
   * duplicated dead weight into every backup. `bytes_stored` is written alongside
   * precisely so that this row is not mistaken for a half-finished ADR-014 migration;
   * backup refuses to run over `data IS NULL` without it.
   *
   * The two must agree, so one is derived from the other here rather than trusted from
   * the caller: a row claiming bytes it does not have is the exact corruption the flag
   * exists to make visible.
   */
  const bytesStored = record.data === null ? 0 : 1
  db.run(
    `INSERT INTO attachments (id, mime_type, byte_size, kind, extracted_text, original_name, checksum, data, bytes_stored)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.mimeType,
      record.byteSize,
      record.kind,
      record.extractedText,
      record.originalName,
      record.checksum,
      record.data,
      bytesStored
    ]
  )
  const stored = getAttachment(db, record.id)
  if (!stored) throw new Error('Attachment row missing immediately after insert')
  return stored
}

export function getAttachment(db: Database, id: string): AttachmentRecord | null {
  const row = db
    .query(`SELECT ${METADATA_COLUMNS} FROM attachments WHERE id = ?`)
    .get(id) as AttachmentRow | null
  return row ? toRecord(row) : null
}

export function listAttachments(db: Database): AttachmentSummary[] {
  const rows = db
    .query(`SELECT ${METADATA_COLUMNS} FROM attachments ORDER BY created_at DESC`)
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

/**
 * A content hash for an upload, used to recognise a repeated image.
 *
 * SHA-256 truncated to 128 bits expressed as hex. The full digest would be
 * larger than the value is worth here: this identifies a file for deduplication,
 * it is not a security boundary, and the stored type is established by
 * inspecting the bytes rather than by trusting a hash.
 */
export function checksumOf(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex').slice(0, 32)
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
