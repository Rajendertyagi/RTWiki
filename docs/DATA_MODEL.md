# Data Model

This document describes the logical and physical data model for RTWiki. It defines entities, relationships, field types, and indexing strategy. Migrations are not written in this phase — this document is the specification that migration files will implement in a later phase.

## 1. Design Principles

- **UUIDs for all primary keys.** Human-readable IDs are not needed and UUIDs avoid collisions when data is later merged from backups.
- **UTC timestamps on all time fields.** Stored as `TEXT` in ISO 8601 format (`YYYY-MM-DDTHH:MM:SS.sssZ`) for SQLite compatibility and sortability.
- **Soft delete everywhere.** No row is ever physically removed from the core tables. A `deleted_at` column marks rows as deleted; a recycle-bin cleanup job handles permanent removal.
- **BlockNote JSON as the canonical content format.** Page content is stored as a versioned, RTWiki-extended BlockNote JSON document (never raw HTML or Markdown). Rich structures use typed custom blocks; when conversion from a source is not lossless, the original rich-HTML source is stored as a typed `richHtml` block inside `pages.content`; unknown block types are preserved, not deleted.
- **Derived-text search.** A `search_index` table holds the readable text derived from each page's own content plus the text of every document it references, queried with `LIKE`. An FTS5 table exists alongside it and is unused — see [3.6](#36-search-index).

## 2. Entity Diagram (Textual)

```
pages
  ├── id (PK, UUID)
  ├── title (TEXT)
  ├── content (JSON)          ← canonical BlockNote JSON
  ├── created_at (TEXT, UTC)
  ├── updated_at (TEXT, UTC)
  ├── deleted_at (TEXT, UTC)  ← NULL = active
  └── version (INTEGER)       ← monotonic content revision counter

page_versions                 ← supports future page history UI
  ├── id (PK, UUID)
  ├── page_id (FK → pages.id)
  ├── content (JSON)
  ├── created_at (TEXT, UTC)
  └── change_description (TEXT, nullable)

tags
  ├── id (PK, UUID)
  └── name (TEXT, UNIQUE)     ← normalized to lowercase

page_tags                     ← many-to-many: pages ↔ tags
  ├── page_id (FK → pages.id)
  ├── tag_id (FK → tags.id)
  └── PRIMARY KEY (page_id, tag_id)

page_links                    ← explicit page-to-page links
  ├── id (PK, UUID)
  ├── source_page_id (FK → pages.id)
  ├── target_page_id (FK → pages.id)
  ├── created_at (TEXT, UTC)
  └── PRIMARY KEY (source_page_id, target_page_id)  ← no duplicate links

attachments
  ├── id (PK, UUID)
  ├── page_id (FK → pages.id, nullable)  ← unattached files are possible
  ├── original_filename (TEXT)
  ├── stored_filename (TEXT)   ← safe generated name on disk
  ├── mime_type (TEXT)
  ├── size_bytes (INTEGER)
  ├── uploaded_at (TEXT, UTC)
  └── deleted_at (TEXT, UTC)

search_index                  ← ordinary table, not FTS5
  ├── page_id (PK, FK → pages.id)
  ├── title (TEXT)
  └── content (TEXT)           ← plain text extracted from the page, plus the
                                  extracted text of every document it references

search_index_fts              ← SQLite FTS5 external-content mirror. CREATED BUT
                                  UNUSED: declared in migration 001 and never
                                  written, read or queried. See "Search storage"
                                  below.

settings
  ├── key (TEXT, PK)
  └── value (TEXT)             ← application-level key-value pairs

backups
  ├── id (PK, UUID)
  ├── created_at (TEXT, UTC)
  ├── archive_path (TEXT)      ← relative path to the ZIP file
  ├── file_size_bytes (INTEGER)
  ├── rtwiki_version (TEXT)    ← version string at backup time
  └── note (TEXT, nullable)    ← optional user note
```

## 3. Entity Details

### 3.1 Pages

The central entity. Each row represents one wiki page.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Surrogate primary key. Generated client-side or server-side as a UUID v4. |
| `title` | TEXT | Human-readable page title. Required, trimmed, max 200 characters. |
| `content` | JSON | Canonical RTWiki-extended BlockNote JSON document — the single canonical page document. `NULL` is not permitted for active pages. Non-lossless HTML/Markdown conversions are preserved as a typed `richHtml` block stored inside this JSON (see [AI_CONTENT_IMPORT.md](AI_CONTENT_IMPORT.md)); there is no separate HTML column. |
| `content_schema_version` | TEXT | Version string of the RTWiki-extended BlockNote schema used by `content`; enables migration on startup. |
| `parent_id` | UUID, nullable | Owning parent page (`NULL` = root). Foreign key → `pages.id` with `ON DELETE SET NULL`, so deleting a parent promotes its children to roots at the parent's former position. Added by migration `003_page_hierarchy`. |
| `position` | INTEGER | Zero-based ordinal among siblings under the same parent, counted over living rows only (`deleted_at IS NULL`). Reordered transactionally by the move endpoint (final-index-after-removal semantics, clamped); always read back sorted, never treated as a stable identifier. Added by migration `003_page_hierarchy`. |
| `created_at` | TEXT | ISO 8601 UTC timestamp of creation. |
| `updated_at` | TEXT | ISO 8601 UTC timestamp of last content change. |
| `deleted_at` | TEXT | `NULL` for active pages. Set on soft delete. |
| `version` | INTEGER | Monotonically increasing content revision number. Increments on every save. |

**Backlinks** are derived from `page_links` (see §3.4), not stored redundantly.

**Hierarchy (workspace tree):** pages form an adjacency-list tree via
`parent_id` with sibling ordering by `position`. A partial index
`idx_pages_parent_position ON pages(parent_id, position) WHERE deleted_at IS NULL`
(added by migration `003_page_hierarchy`) serves child reads. Structural
mutations — create, duplicate, delete-promotion, and move — are transactional
(`BEGIN IMMEDIATE`), reject self/ancestor cycles server-side, and return an
authoritative reconciliation payload (`page`, origin/destination sibling
lists). Sibling indexes are absolute ordinals, so clients must hold the
complete page collection before computing them; windowed list responses are
not sufficient. See [ADR-008](adr/ADR-008-page-hierarchy-and-workspace-tree.md).

### 3.2 Page Versions

A historical snapshot table. Currently unused by the UI but structurally ready for a future page-history feature. One row is created each time the user explicitly checkpoints a version or on a defined interval (e.g., every 10 autosave cycles). The MVP does not require a history UI.

### 3.3 Tags

A flat, case-insensitive tag namespace. Tag names are normalized to lowercase and stripped of leading/trailing whitespace before insertion. Duplicate tag names are rejected at the database level by the `UNIQUE` constraint.

### 3.4 Page Tags and Page Links

Both are junction tables that enforce referential integrity at the database level.

- `page_tags` enables a page to have zero or more tags and a tag to appear on zero or more pages.
- `page_links` enables explicit forward links from one page to another. The backlink view is computed by querying `page_links` where `target_page_id = ?`.

### 3.5 Attachments

Image bytes are stored in the `attachments.data` column, not as files in a directory (see [ADR-014](adr/ADR-014-blob-stored-image-bytes.md)). The row is written as a single statement, so an attachment cannot exist as bytes without metadata or the reverse. Files left behind by a database created before that change are read once by the migration and then left on disk untouched; removing them is a separate retention decision.

**Documents share this table** ([ADR-015](adr/ADR-015-document-attachments.md)). `kind` distinguishes an image from a document, and `extracted_text` holds the readable text a document yielded, which is appended to the **owning page's** `search_index` row so the document can be found by what is inside it. A `.txt`, `.md` or `.html` upload has its text stored and **no bytes at all**, because those formats carry no signature: the application will not serve a file whose type was never established, so keeping the bytes would store content no user could ever retrieve. `bytes_stored` records which case a row is, so a deliberate absence is never mistaken for an unfinished ADR-014 migration.

**Addressing:** The browser addresses an attachment by `id`, never by filename. `GET /api/attachments/:id` looks the row up and streams its bytes, so no user-supplied string ever reaches the filesystem — there is no path to reach. See [ADR-013](adr/ADR-013-image-attachments.md).

**Filename generation:** Stored names are `<UUID>.<extension>`, where the extension is chosen from the file's own detected type — never from the uploader's filename or its declared `Content-Type`. The original filename is kept in `original_name` for display only, with path separators and control characters removed. A request naming `../../../etc/passwd` therefore produces an ordinary UUID name like any other upload; there is no traversal to defend against, because no part of the request becomes a path.

**Type and size:** `mime_type` and `byte_size` are recorded from the bytes, never from the request. The type is decided by reading the file's container structure with `file-type`, and the accepted-format list in `src/shared/attachments/image-formats.ts` is what maps that to a stored type. Accepted formats are PNG, JPEG, GIF, WebP, AVIF and BMP. SVG, TIFF, HEIC and JPEG XL are deliberately not accepted — see [ADR-013](adr/ADR-013-image-attachments.md). Pixel dimensions are read from the header without decoding and capped at `PROVISIONAL_MAX_IMAGE_PIXELS`; the byte ceiling is the separate 50 MB attachment limit.

**Ownership:** There is no foreign key to `pages`. An attachment may be uploaded before it is referenced, and a note may be deleted while its images are still on disk. The consequence is that deleting a page does not delete its images: the files become orphans, reclaimable from this table but not yet reclaimed automatically. This is tracked as an open item in [KNOWN_BUGS.md](KNOWN_BUGS.md).

### 3.6 Search Index

`search_index` is an **ordinary table**, not an FTS5 virtual table, and is queried with `LIKE`:

- On page create or content update: extract plain text, upsert the row.
- On page soft-delete or permanent delete: delete the row.
- On attachment delete: recompute the rows of every page that referenced it, so the
  removed document's words stop being findable.

**Content extraction:** The extractor walks the BlockNote JSON tree (including typed custom blocks such as cards, tabs, callouts, and grids) and collects text from text blocks, heading blocks, list items, table cells, code blocks, and custom-block text. It skips image URLs, attachment paths, and embedded script content. Diagram and Mind Map blocks are skipped entirely; only the page title is searchable for those. A Markdown page indexes its own source; an HTML page indexes text extracted from its HTML with `script`/`style`/`template` subtrees skipped.

**A document's text is part of its owning page's row.** A page owns an attachment by referencing its URL in its own content (there is no foreign key, by design — see 3.5). Attachment text is therefore *appended* to the owning page's `search_index` row rather than given an index of its own, so a page with both prose and an attached PDF appears **once** in results and is found by words from either. The page's own text is placed first so a large attachment can never displace it; the whole row is bounded (`SEARCH_INDEX_MAX_CHARS`).

#### The unused FTS5 table

Migration `001` also creates `search_index_fts`, an external-content FTS5 mirror of `search_index`. **It is never written, read or queried.** `GET /api/pages?q=` searches the base table with `si.title LIKE ? OR si.content LIKE ?`.

It is left in place deliberately, and the current search path is not changed to use it. Switching to FTS5 would be a real behavioural change — tokenisation, ranking, and partial-word matching all differ from `LIKE`, and `LIKE '%term%'` is what the current results and tests are written against. That belongs in its own phase with its own evidence, not inside a change about document storage. `LIKE '%term%'` cannot use an index, so search is a full scan of the index; that is a known cost, not a correctness problem, and it is bounded by the row-size cap above.

### 3.7 Settings

A simple key-value store for application-level configuration that the user can change at runtime (e.g., theme preference, autosave interval). The schema for the keys and their domains is defined in [DEVELOPMENT_STANDARDS.md](DEVELOPMENT_STANDARDS.md).

### 3.8 Backups

Each backup record points to a ZIP archive on disk. The archive path is relative to the data directory (`data/backups/`). The `rtwiki_version` column records the application version at backup time, enabling the restore path to reject archives from incompatible versions. Backups include the database and attachments but exclude log files.

## 4. Deletion and Recycle-Bin Behaviour

| Action | Effect |
|--------|--------|
| Soft delete page | Sets `pages.deleted_at` to current UTC timestamp. Owned attachments are also soft-deleted. The `search_index` row is removed, so a note in the recycle bin is not findable. |
| Restore from recycle bin | Sets `deleted_at` back to `NULL`. |
| Permanent deletion | Performed by an explicit user action or an automated cleanup job that removes rows where `deleted_at` is older than a configurable retention period (default: 30 days). |
| Restore from backup | Imports rows from the backup archive into the live database. Conflicting UUIDs are handled by the restore service (overwrite or skip based on the user's choice). |

## 5. Cross-References

- [ARCHITECTURE.md](ARCHITECTURE.md) — how each layer interacts with these entities
- [SECURITY.md](SECURITY.md) — attachment safety and path-traversal prevention
- [DATA_MODEL.md](DATA_MODEL.md) — this document
- [DEVELOPMENT_STANDARDS.md](DEVELOPMENT_STANDARDS.md) — naming conventions and migration rules
- [AI_CONTENT_IMPORT.md](AI_CONTENT_IMPORT.md) — note-package contract and import pipeline
- [ADR-006](adr/ADR-006-rich-content-and-import-contract.md) — rich-content model and import contract
- [ADR-007](adr/ADR-007-sandboxed-custom-content.md) — sandboxed custom content
- [ADR-008](adr/ADR-008-page-hierarchy-and-workspace-tree.md) — page hierarchy and the workspace tree
