# Data Model

This document describes the logical and physical data model for RTWiki. It defines entities, relationships, field types, and indexing strategy. Migrations are not written in this phase — this document is the specification that migration files will implement in a later phase.

## 1. Design Principles

- **UUIDs for all primary keys.** Human-readable IDs are not needed and UUIDs avoid collisions when data is later merged from backups.
- **UTC timestamps on all time fields.** Stored as `TEXT` in ISO 8601 format (`YYYY-MM-DDTHH:MM:SS.sssZ`) for SQLite compatibility and sortability.
- **Soft delete everywhere.** No row is ever physically removed from the core tables. A `deleted_at` column marks rows as deleted; a recycle-bin cleanup job handles permanent removal.
- **BlockNote JSON as the canonical content format.** Page content is stored as a JSON blob, never as raw HTML or Markdown.
- **FTS5 for search.** A dedicated virtual table indexes searchable text derived from page content.

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

search_index                  ← SQLite FTS5 virtual table (auto-maintained)
  ├── page_id (PK, FK → pages.id)
  ├── title (TEXT)
  └── content (TEXT)           ← plain text extracted from BlockNote JSON

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
| `content` | JSON | Canonical BlockNote JSON document. `NULL` is not permitted for active pages. |
| `created_at` | TEXT | ISO 8601 UTC timestamp of creation. |
| `updated_at` | TEXT | ISO 8601 UTC timestamp of last content change. |
| `deleted_at` | TEXT | `NULL` for active pages. Set on soft delete. |
| `version` | INTEGER | Monotonically increasing content revision number. Increments on every save. |

**Backlinks** are derived from `page_links` (see §3.4), not stored redundantly.

### 3.2 Page Versions

A historical snapshot table. Currently unused by the UI but structurally ready for a future page-history feature. One row is created each time the user explicitly checkpoints a version or on a defined interval (e.g., every 10 autosave cycles). The MVP does not require a history UI.

### 3.3 Tags

A flat, case-insensitive tag namespace. Tag names are normalized to lowercase and stripped of leading/trailing whitespace before insertion. Duplicate tag names are rejected at the database level by the `UNIQUE` constraint.

### 3.4 Page Tags and Page Links

Both are junction tables that enforce referential integrity at the database level.

- `page_tags` enables a page to have zero or more tags and a tag to appear on zero or more pages.
- `page_links` enables explicit forward links from one page to another. The backlink view is computed by querying `page_links` where `target_page_id = ?`.

### 3.5 Attachments

Each attachment row records metadata about a file stored on disk. The actual file is stored at a generated path derived from the `stored_filename` column. The mapping is:

```
<data_directory>/attachments/<stored_filename>
```

**Ownership:** Attachments are optionally owned by a page (`page_id`). If `page_id` is `NULL`, the attachment exists independently (e.g., a file the user wants to keep in the library but not yet attached to any page). When a page is soft-deleted, its owned attachments are also soft-deleted.

**Filename generation:** Stored filenames are generated as `<UUID>_<original_filename>` to prevent collisions while preserving the original name for display.

### 3.6 Search Index (FTS5)

The `search_index` table is a SQLite FTS5 virtual table. It is kept in sync automatically:

- On page `INSERT` or `UPDATE`: extract plain text from the BlockNote JSON content, upsert the row.
- On page soft-delete: delete the corresponding row from the FTS5 table.

**Content extraction:** The extractor walks the BlockNote JSON tree and collects text from text blocks, heading blocks, list items, table cells, and code blocks. It skips image URLs, attachment paths, and embedded script content.

### 3.7 Settings

A simple key-value store for application-level configuration that the user can change at runtime (e.g., theme preference, autosave interval). The schema for the keys and their domains is defined in [DEVELOPMENT_STANDARDS.md](DEVELOPMENT_STANDARDS.md).

### 3.8 Backups

Each backup record points to a ZIP archive on disk. The archive path is relative to the data directory (`data/backups/`). The `rtwiki_version` column records the application version at backup time, enabling the restore path to reject archives from incompatible versions. Backups include the database and attachments but exclude log files.

## 4. Deletion and Recycle-Bin Behaviour

| Action | Effect |
|--------|--------|
| Soft delete page | Sets `pages.deleted_at` to current UTC timestamp. Owned attachments are also soft-deleted. FTS5 row is removed. |
| Restore from recycle bin | Sets `deleted_at` back to `NULL`. |
| Permanent deletion | Performed by an explicit user action or an automated cleanup job that removes rows where `deleted_at` is older than a configurable retention period (default: 30 days). |
| Restore from backup | Imports rows from the backup archive into the live database. Conflicting UUIDs are handled by the restore service (overwrite or skip based on the user's choice). |

## 5. Cross-References

- [ARCHITECTURE.md](ARCHITECTURE.md) — how each layer interacts with these entities
- [SECURITY.md](SECURITY.md) — attachment safety and path-traversal prevention
- [DATA_MODEL.md](DATA_MODEL.md) — this document
- [DEVELOPMENT_STANDARDS.md](DEVELOPMENT_STANDARDS.md) — naming conventions and migration rules
