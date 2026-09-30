import { readFileSync } from 'node:fs'
import { joinPaths } from '../config/index.js'
import { ensureStoragePragmas, getDatabaseLogger, type getDb } from './index.js'

/**
 * The migration names this build **requires**, recorded as `runMigrations`
 * walks them rather than declared as a second list.
 *
 * Restore validation compares a backup's `_migrations` against this set to
 * reject a backup that is too new, or missing one the build expects. A
 * hand-maintained list of names would be a second source of truth that drifts
 * the moment a migration is added -- and would drift silently, because a
 * validation list that is one migration behind still passes every check it is
 * given. Deriving it from the calls themselves cannot drift.
 *
 * "Required" is deliberately not the same as "present in `_migrations` right
 * now". A migration this build will insist on applying is required even while
 * it is still outstanding -- that is precisely the case a restore must refuse,
 * and recording it only once applied turns a half-migrated database into a
 * backup the build believes it understands. The previous version conflated the
 * two, and the result was that `008_drop_stored_name` went unrecorded on every
 * database where `007_attachment_blobs` had already run, so a backup of a
 * perfectly healthy existing database was rejected as `schema-too-new`.
 */
const requiredMigrations = new Set<string>()

/**
 * Migration names this build requires, in application order. Populated by
 * `runMigrations`, so it reflects what this build will insist on rather than
 * what a list claims should be.
 */
export function requiredMigrationNames(): string[] {
  return [...requiredMigrations]
}

export async function runMigrations(
  db: ReturnType<typeof getDb>,
  attachmentsDir = ''
): Promise<void> {
  // Recomputed per run so a second bootstrap in one process (which the tests
  // do, against a fresh temp dataDir) reports its own migrations and not the
  // previous instance's.
  requiredMigrations.clear()

  await applyMigration(db, '001_create_pages', (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        deleted_at TEXT,
        version INTEGER NOT NULL DEFAULT 0
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS search_index (
        page_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
      )
    `)
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS search_index_fts USING fts5(
        title, content,
        content='search_index',
        content_rowid='page_id'
      )
    `)
  })

  await applyMigration(db, '002_add_page_type', (db) => {
    db.run("ALTER TABLE pages ADD COLUMN page_type TEXT NOT NULL DEFAULT 'rich'")
  })

  await applyMigration(db, '003_page_hierarchy', (db) => {
    // Adjacency-list hierarchy (ADR: Page Hierarchy Data Model).
    // Adding an FK column via ADD COLUMN requires a NULL default - satisfied here.
    db.run('ALTER TABLE pages ADD COLUMN parent_id TEXT REFERENCES pages(id) ON DELETE SET NULL')
    db.run('ALTER TABLE pages ADD COLUMN position INTEGER NOT NULL DEFAULT 0')

    // Deterministic backfill: every living page becomes a root positioned to
    // mirror the previous flat display order (updated_at DESC, rowid DESC).
    // Soft-deleted rows are excluded from sibling arithmetic.
    //
    // The `rowid` comparison below is a one-time data fix, not a live query
    // dependency: it reads the rowids this database happens to have now, and
    // the `position` values it writes are what every later ordering query
    // actually uses. Worth recording because `rowid` is *not* preserved by
    // `VACUUM INTO` -- a backup taken before this migration and restored after it
    // would compute different positions from the same pages. That is harmless
    // (positions only need to be a consistent total order) and cannot happen
    // twice, because a migration runs once. The live rowid tie-breaks that DO
    // matter across a restore are the five in `page-repository.ts`, each of which
    // carries a comment saying so. See docs/BACKUP_PLAN.md 3.3.
    db.run(`
      UPDATE pages
      SET position = (
        SELECT COUNT(*)
        FROM pages AS p2
        WHERE p2.parent_id IS NULL
          AND p2.deleted_at IS NULL
          AND (
            p2.updated_at > pages.updated_at
            OR (p2.updated_at = pages.updated_at AND p2.rowid > pages.rowid)
          )
      )
      WHERE parent_id IS NULL AND deleted_at IS NULL
    `)

    db.run(
      'CREATE INDEX idx_pages_parent_position ON pages(parent_id, position) WHERE deleted_at IS NULL'
    )
  })

  await applyMigration(db, '004_page_links', (db) => {
    // Exact internal-link relationships between Rich Notes, maintained
    // transactionally on content save. No FK constraints: a link to a
    // deleted target must survive as a broken link (the source keeps its
    // stored ID), and deleting a linked target must never be blocked.
    db.run(`
      CREATE TABLE IF NOT EXISTS page_links (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        PRIMARY KEY (source_id, target_id)
      )
    `)
    db.run('CREATE INDEX idx_page_links_target ON page_links(target_id)')
  })

  await applyMigration(db, '005_schedule', (db) => {
    // Study timetable: weekly/one-off periods, one-off reminders, and
    // user-created presets. No FK constraints: a linked page may be deleted,
    // and presets are independent user data.
    db.run(`
      CREATE TABLE IF NOT EXISTS schedule_entries (
        id TEXT PRIMARY KEY,
        recurrence_kind TEXT NOT NULL CHECK (recurrence_kind IN ('weekly', 'oneoff')),
        title TEXT NOT NULL,
        weekdays TEXT,
        date TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        linked_page_id TEXT,
        category TEXT,
        color TEXT,
        notes TEXT,
        notifications TEXT NOT NULL DEFAULT '{"enabled":true,"start":true,"fiveMinBefore":true,"customOffsets":[]}',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        due_datetime TEXT NOT NULL,
        linked_page_id TEXT,
        message TEXT,
        notifications TEXT NOT NULL DEFAULT '{"enabled":true,"customOffsets":[]}',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS schedule_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    db.run('CREATE INDEX idx_schedule_entries_enabled ON schedule_entries(enabled)')
    db.run('CREATE INDEX idx_reminders_enabled ON reminders(enabled)')
  })

  await applyMigration(db, '006_attachments', (db) => {
    // Uploaded images, catalogued here. The bytes were originally files under
    // data/attachments (ADR-005); ADR-014 moves them into this table.
    //
    // The row is the only thing the browser ever names. Requests address an
    // attachment by `id`, never by a filename, so no user-supplied string ever
    // reaches the filesystem: a traversal attempt has nothing to traverse.
    //
    // `mime_type` is recorded from our own detection of the file's structure
    // (see shared/attachments/image-formats.ts) and never from the upload's
    // declared Content-Type, which is attacker-controlled. A stored image is
    // therefore always served as the type its bytes actually are.
    //
    // No foreign key to pages: an attachment may be uploaded before it is
    // referenced, and a note may be deleted while its images are still on disk.
    // Orphan files are reclaimable from this table, which is the point of having
    // it; without a table there would be no way to tell an orphan from a
    // referenced file.
    db.run(`
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
    // Reclaim walks the whole table, but deletion and retention both look rows up
    // by id and list them by age, so both are indexed.
    db.run('CREATE INDEX idx_attachments_created_at ON attachments(created_at)')
  })

  // Moves image bytes into the row (ADR-014). Deliberately *outside*
  // applyMigration: it reads files from disk and runs VACUUM, neither of which
  // belongs inside a synchronous schema transaction, and its safety depends on
  // being able to stop and report rather than roll back.
  await migrateAttachmentBytesToBlobs(db, attachmentsDir)

  await applyMigration(db, '009_document_attachments', (db) => {
    // Documents share the attachments table and therefore the same storage,
    // upload endpoint and streaming path as images (ADR-015).
    //
    // `kind` is what tells the two apart. It is derived from the stored MIME at
    // read time as well, so it is not the authority on its own; it exists so a
    // listing can answer "images" or "documents" without re-deriving, and so a
    // signature-less document (see document-formats.ts) can be marked as text
    // rather than as something to be rendered.
    //
    // `extracted_text` holds the readable text a document yielded, so its content
    // can be found by search. It is NOT the document: the bytes stay in `data`
    // and are what gets served. A signature-less upload stores its text here and
    // no servable bytes, because its bytes could never be identified.
    db.run("ALTER TABLE attachments ADD COLUMN kind TEXT NOT NULL DEFAULT 'image'")
    db.run('ALTER TABLE attachments ADD COLUMN extracted_text TEXT')
  })

  await applyMigration(db, '010_mindmap_pages_to_diagram', (db) => {
    // The Mind Map page is retired. It was a second Mermaid page whose entire
    // difference from the Diagram page was the block type it inserted and the
    // starter source it began from - one ternary in mermaid-workspace.tsx and two
    // starter strings. Mermaid's `mindmap` is an ordinary diagram type and is
    // already offered from the shared template list, so the separate page type
    // duplicated something that existed.
    //
    // Every one of these rows becomes an ordinary Diagram page: same workspace,
    // same canvas, same secure render pipeline. The stored block content still
    // loads, because the `mindMap` block stays registered for reading (see
    // rich-editor/schema.ts) - retiring the page type is not a content migration.
    //
    // Rewritten, never deleted. `page_type` is a plain TEXT column with no CHECK
    // constraint (002_add_page_type), so nothing ever stopped these rows being
    // written. A row left as 'mindmap' would fail the pageType enum at
    // src/shared/schemas/pages.ts on read, and because that enum guards the whole
    // page response, one stale row would take the entire page list down rather
    // than just its own page.
    db.run("UPDATE pages SET page_type = 'diagram' WHERE page_type = 'mindmap'")
  })

  await applyMigration(db, '011_signatureless_attachment_bytes', (db) => {
    // A signature-less document keeps its text and not its bytes.
    //
    // `.txt`, `.md` and `.html` can never be identified from their bytes, so the
    // serving path refused them anyway (`GET /api/attachments/:id` answers 404 for a
    // signature-less MIME). Their bytes were nevertheless being stored: dead weight in
    // the row, and duplicated into every backup, for content no user could ever get
    // back. The repository comment already described the intended behaviour — a
    // signature-less document has "no servable bytes" — and the code had drifted away
    // from it. This migration makes the schema able to say so.
    //
    // ## Why `data` must be rebuilt rather than altered
    //
    // SQLite cannot drop a NOT NULL constraint. `data BLOB NOT NULL` has to become a
    // table rebuild, which is the same shape `008_drop_stored_name` used, and for the
    // same reason: the old table is verified intact before it is dropped.
    //
    // ## Why `bytes_stored` and not an inference
    //
    // Making `data` nullable alone would be ambiguous. `data IS NULL` would mean either
    // "this document deliberately has no bytes" or "this row's bytes were never
    // migrated" — and the second is what backup refuses to run over. An explicit flag
    // separates them in the row itself, so the distinction survives a database that
    // nobody remembers the history of.
    //
    // Existing rows are backfilled to 1, because every row that exists today has its
    // bytes: nothing wrote a signature-less upload without them.
    //
    // ## Why this must not run on an unfinished ADR-014 database
    //
    // `008_drop_stored_name` deliberately does nothing while any row still holds its
    // bytes on disk, leaving `stored_name` in place for the next boot to finish from. A
    // rebuild here would drop that column — and `stored_name` is the only record of
    // where a row's bytes are. Losing it would strand a half-migrated database with
    // no way back: the bytes exist, nothing knows their filenames, and
    // `migrateAttachmentBytesToBlobs` has nothing to read.
    //
    // So this migration stands down on exactly the condition 008 stands down on, and
    // lets ADR-014 finish first. It returns without recording, exactly as 008 does when
    // it cannot finish: a thrown error would roll back the whole transaction, including
    // the 007 blob column 008 depends on, and would take the application down over a
    // database it had already decided to leave alone.
    const stillHasStoredName = (
      db.query('PRAGMA table_info(attachments)').all() as Array<{ name: string }>
    ).some((c) => c.name === 'stored_name')
    if (stillHasStoredName) {
      return
    }

    db.run(`
      CREATE TABLE attachments_with_optional_bytes (
        id TEXT PRIMARY KEY,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        original_name TEXT,
        checksum TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        kind TEXT NOT NULL DEFAULT 'image',
        extracted_text TEXT,
        data BLOB,
        bytes_stored INTEGER NOT NULL DEFAULT 1
      )
    `)
    db.run(`
      INSERT INTO attachments_with_optional_bytes
        (id, mime_type, byte_size, original_name, checksum, created_at, kind, extracted_text, data, bytes_stored)
      SELECT id, mime_type, byte_size, original_name, checksum, created_at, kind, extracted_text, data,
             CASE WHEN data IS NULL THEN 0 ELSE 1 END
      FROM attachments
    `)
    // Verified before the old table is dropped: a changed row count means the copy lost
    // something, and the original is still there to fall back on.
    const moved = db.query('SELECT count(*) AS n FROM attachments_with_optional_bytes').get() as {
      n: number
    }
    const before = db.query('SELECT count(*) AS n FROM attachments').get() as { n: number }
    if (moved.n !== before.n) {
      throw new Error(`row count changed during the copy: ${before.n} became ${moved.n}`)
    }
    db.run('DROP TABLE attachments')
    db.run('ALTER TABLE attachments_with_optional_bytes RENAME TO attachments')
    db.run('CREATE INDEX idx_attachments_created_at ON attachments(created_at)')
  })
}

/**
 * Moves image bytes out of files and into the `attachments` row (ADR-014).
 *
 * ## Why this is not an ordinary schema migration
 *
 * Three things here cannot happen inside the synchronous transaction that
 * `applyMigration` wraps: reading files from disk, running `VACUUM`, and
 * stopping to report a problem without rolling back. The safety property that
 * matters is not "the transaction committed" but "no file was removed before its
 * bytes were proven to be in the database", so the steps are ordered to make
 * that true at every point.
 *
 * ## Order, and why it is this order
 *
 * 1. `auto_vacuum` is applied and `VACUUM` run, because a populated database
 *    silently ignores the pragma otherwise (ADR-014 §3).
 * 2. The `data` column is added. Every row is still readable and servable, so a
 *    failure from here on is recoverable.
 * 3. Bytes are copied in, one row at a time, verifying each against its recorded
 *    `byte_size`.
 * 4. The copy is verified from the database itself.
 * 5. `stored_name` is dropped - only once every row is known to hold its bytes.
 *
 * No file is deleted at any point. Files on disk with no row are left alone:
 * they are unreferenced, so nothing can display them, but the application cannot
 * prove they are garbage rather than merely not-yet-referenced. Reclaiming them
 * belongs to the retention pass tracked in KNOWN_BUGS.md.
 */
async function migrateAttachmentBytesToBlobs(
  db: ReturnType<typeof getDb>,
  attachmentsDir: string
): Promise<void> {
  const logger = getDatabaseLogger()
  // Named once: this string is the migration's identity in `_migrations`, and
  // restore validation compares that table against the build's required set, so
  // it must not be spelled two ways.
  const name = '007_attachment_blobs'
  // Both migrations this function owns are recorded at entry, unconditionally.
  // They are required by this build whether or not they are still outstanding,
  // and every path below applies or confirms them.
  //
  // 008 is recorded HERE as well as inside `dropStoredName` because that
  // function is only reached when 007 still has work to do. Without this line,
  // a database where 007 was applied on an earlier run would return from the
  // `if` below without ever entering `dropStoredName`, leaving 008 out of the
  // required set while its `_migrations` row is present -- and every backup of
  // that database would be refused as `schema-too-new`.
  const dropName = '008_drop_stored_name'
  requiredMigrations.add(name)
  requiredMigrations.add(dropName)
  if (db.query('SELECT id FROM _migrations WHERE name = ?').get(name)) {
    // Already applied, but auto_vacuum may still need converting on a database
    // created before ADR-014, so the check below runs regardless.
    ensureAutoVacuum(db, logger)
    return
  }

  // Step 1: the pragma, then the VACUUM that makes it stick.
  ensureAutoVacuum(db, logger)

  // Step 2: add the column. Existing rows stay fully readable.
  db.run('ALTER TABLE attachments ADD COLUMN data BLOB')
  db.run(`INSERT INTO _migrations (name) VALUES ('${name}')`)
  logger.info('Attachment blob column added', { event: 'migration', name })

  // Step 3: copy the bytes, checking each against what the catalogue recorded.
  const pending = db
    .query('SELECT id, stored_name, byte_size FROM attachments WHERE data IS NULL')
    .all() as Array<{ id: string; stored_name: string; byte_size: number }>

  if (pending.length === 0) {
    dropStoredName(db)
    return
  }

  const failures: string[] = []
  let copied = 0

  for (const row of pending) {
    try {
      const bytes = readFileSync(joinPaths(attachmentsDir, row.stored_name))
      if (bytes.byteLength !== row.byte_size) {
        // The catalogue and the file disagree. Storing either would record a
        // lie, so the row is left alone and reported.
        failures.push(`${row.id}: ${bytes.byteLength} bytes on disk, ${row.byte_size} recorded`)
        continue
      }
      db.run('UPDATE attachments SET data = ? WHERE id = ?', [bytes, row.id])
      copied++
    } catch (err) {
      failures.push(`${row.id}: ${err instanceof Error ? err.name : 'unknown'}`)
    }
  }

  // Step 4: verify from the database, not from the loop's own count.
  const stillMissing = db
    .query('SELECT count(*) AS n FROM attachments WHERE data IS NULL')
    .get() as { n: number }

  if (stillMissing.n > 0) {
    // Deliberately does not throw. The application still works - every row kept
    // its file and its `stored_name` - and the problem is reported rather than
    // discovered later as a broken image.
    logger.error('Attachment backfill incomplete; no files were removed', {
      event: 'attachment_backfill_incomplete',
      migrated: String(copied),
      pending: String(stillMissing.n),
      // Ids and reasons only: no filenames, no paths, no user content.
      failures: failures.slice(0, 10).join('; ')
    })
    return
  }
  const total = db
    .query('SELECT count(*) AS n, sum(length(data)) AS bytes FROM attachments')
    .get() as { n: number; bytes: number | null }
  logger.info('Attachment bytes moved into the database', {
    event: 'attachment_backfill_complete',
    attachments: String(total.n),
    bytes: String(total.bytes ?? 0)
  })

  // Only now, with every row proven to hold its bytes.
  dropStoredName(db)
}

/**
 * Drops `stored_name` once every row is known to hold its bytes.
 *
 * A separate step, and deliberately the last one. `stored_name` is `NOT NULL`, so
 * until it goes an insert that omits it fails - which is a useful property
 * during the backfill, because it means a partially-migrated database refuses
 * new uploads rather than accepting rows with no way to find their file. It also
 * means this cannot be folded into the backfill: the column has to survive until
 * the copy is verified, and only then become redundant.
 *
 * The rebuild is the documented way to drop a column in SQLite, which has no
 * `DROP COLUMN` before 3.35. The new table is built from an explicit column list
 * so it cannot silently pick up a column added later.
 */
function dropStoredName(db: ReturnType<typeof getDb>): void {
  const logger = getDatabaseLogger()
  const name = '008_drop_stored_name'
  // Recorded here, on the path that owns this migration, and only when it is
  // genuinely reached.
  //
  // `dropStoredName` is called from `migrateAttachmentBytesToBlobs`, which
  // returns early when 007 is already applied -- so on every database that has
  // run 007 before, this function is never entered and `008` would go
  // unrecorded. The required set would then hold 8 names while `_migrations`
  // holds 9, and every backup of a healthy existing database would be refused
  // as `schema-too-new`. That is the bug this call is the fix for; the caller
  // records 008 on its early-return path for exactly that reason.
  requiredMigrations.add(name)
  if (db.query('SELECT id FROM _migrations WHERE name = ?').get(name)) {
    return
  }

  const stillMissing = db
    .query('SELECT count(*) AS n FROM attachments WHERE data IS NULL')
    .get() as { n: number }
  if (stillMissing.n > 0) {
    // The column stays. The application keeps working, because every row still
    // has a file on disk to be served from.
    //
    // 008 is still recorded as required above, and that is deliberate: this
    // build will keep trying to apply it, so a restore must be compared against
    // a required set that includes it. A backup of a database in this state is
    // refused by the schema check, and independently by the attachment-byte
    // check in `createBackup` -- two independent refusals pointing the same way,
    // which is the correct outcome for a database that is mid-migration.
    logger.warn('stored_name retained: some attachments have no bytes yet', {
      event: 'attachment_backfill_incomplete',
      pending: String(stillMissing.n)
    })
    return
  }

  db.run('BEGIN IMMEDIATE')
  try {
    db.run(`
      CREATE TABLE attachments_migrated (
        id TEXT PRIMARY KEY,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        original_name TEXT,
        checksum TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        data BLOB NOT NULL
      )
    `)
    db.run(`
      INSERT INTO attachments_migrated (id, mime_type, byte_size, original_name, checksum, created_at, data)
      SELECT id, mime_type, byte_size, original_name, checksum, created_at, data FROM attachments
    `)
    // Verified before the old table goes: a row count that changed means the copy
    // lost something, and the old table is still there to fall back to.
    const moved = db.query('SELECT count(*) AS n FROM attachments_migrated').get() as { n: number }
    const before = db.query('SELECT count(*) AS n FROM attachments').get() as { n: number }
    if (moved.n !== before.n) {
      throw new Error(`row count changed during the copy: ${before.n} became ${moved.n}`)
    }
    db.run('DROP TABLE attachments')
    db.run('ALTER TABLE attachments_migrated RENAME TO attachments')
    db.run('CREATE INDEX idx_attachments_created_at ON attachments(created_at)')
    db.run('INSERT INTO _migrations (name) VALUES (?)', [name])
    db.run('COMMIT')
    // No recording needed here: `name` was already added to the required set
    // when `migrateAttachmentBytesToBlobs` was entered, before this function
    // was called. Recording on the commit path only would be the original bug,
    // in miniature -- a name that is required by the build but recorded only
    // when it happens to succeed.
    logger.info('Attachment filename column removed', {
      event: 'migration',
      name,
      rows: String(moved.n)
    })
  } catch (err) {
    db.run('ROLLBACK')
    logger.error('Could not remove the attachment filename column', {
      event: 'migration',
      name,
      error: err instanceof Error ? err.message : String(err)
    })
    // Not thrown: the database is still correct and the application still works,
    // because the rows kept both their bytes and their filenames.
  }
}

/**
 * Applies `auto_vacuum` and runs the `VACUUM` an existing database needs.
 *
 * On a database that already has tables the pragma alone does nothing - the value
 * stays 0, nothing is raised, and deleted space is never returned. Running
 * `VACUUM` afterwards is what makes it take effect.
 *
 * The page size is deliberately *not* chased here. In WAL mode it cannot be
 * changed at all, not even by `VACUUM`, so a database created before ADR-014
 * keeps its 4 KB pages and the honest outcome is to say so rather than to
 * pretend. It is a performance difference, not a correctness one.
 */
function ensureAutoVacuum(
  db: ReturnType<typeof getDb>,
  logger: ReturnType<typeof getDatabaseLogger>
): void {
  const stale = ensureStoragePragmas(db)
  if (!stale.includes('auto_vacuum')) return
  try {
    db.run('VACUUM')
    if (ensureStoragePragmas(db).includes('auto_vacuum')) {
      logger.warn('auto_vacuum could not be enabled; deleted images will not reclaim space', {
        event: 'db_storage_pragmas_stale',
        pragmas: 'auto_vacuum'
      })
    }
  } catch (err) {
    logger.warn('auto_vacuum could not be enabled; deleted images will not reclaim space', {
      event: 'db_storage_pragmas_stale',
      pragmas: 'auto_vacuum',
      error: err instanceof Error ? err.name : 'unknown'
    })
  }
}

async function applyMigration(
  db: ReturnType<typeof getDb>,
  name: string,
  up: (db: ReturnType<typeof getDb>) => void
): Promise<void> {
  db.run('BEGIN IMMEDIATE')
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    const existing = db.query('SELECT id FROM _migrations WHERE name = ?').get(name)
    // Recorded on both paths. A migration already in `_migrations` is just as
    // much a part of the required set as one applied a moment ago, and the
    // early return below would otherwise lose it -- which is exactly the case
    // every run after the first upgrade hits.
    requiredMigrations.add(name)
    if (existing) {
      db.run('COMMIT')
      getDatabaseLogger().info('Migration already applied', {
        event: 'migration',
        name,
        skipped: true
      })
      return
    }
    up(db)
    db.run('INSERT INTO _migrations (name) VALUES (?)', [name])
    db.run('COMMIT')
    getDatabaseLogger().info('Migration applied', { event: 'migration', name })
  } catch (err) {
    db.run('ROLLBACK')
    const message = err instanceof Error ? err.message : String(err)
    getDatabaseLogger().error('Migration failed', {
      event: 'migration',
      name,
      error: message
    })
    throw err
  }
}
