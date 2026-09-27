# ADR-014: Image Bytes Stored in the Database

- **Status:** Accepted
- **Date:** 2026-09-27
- **Supersedes:** The attachments-storage sections of [ADR-005](ADR-005-portable-data-layout.md) and [ADR-013](ADR-013-image-attachments.md)
- **Related:** [ADR-002](ADR-002-bun-hono-sqlite.md) (Bun + Hono + SQLite), [ADR-004](ADR-004-canonical-block-json-format.md), [ADR-013](ADR-013-image-attachments.md) (image validation and serving)

## Context

ADR-005 places attachments under `data/attachments/`, and ADR-013 §4 stores each image there as a file while the `attachments` table catalogues it. That arrangement has a defect that is easy to overlook because nothing reports it at the time it happens.

Writing an upload is two steps: write the file, then insert the row. Deleting one is two steps: delete the row, then unlink the file. Neither pair is atomic, and a crash or a failed `unlink` between them leaves the two disagreeing. The upload path chose to write the file first, so an interrupted upload leaves a file no row can reach; the delete path chose to remove the row first, so a failed `unlink` leaves a file nothing can reach. The GET route already carries a branch for the mirror case — a row whose file has gone — which is the code admitting this state is reachable.

This is not theoretical. The development database for this project holds 511 pages and 4 attachment rows alongside **14 image files that no row references**, all left by earlier runs. Nothing failed; nothing warned. A backup also has to capture a database file and a directory of files and keep them consistent with each other, which is a second thing to get wrong.

The question is whether the bytes belong on the filesystem at all.

## Decision

### 1. Image bytes are stored in the database, in the `attachments` row

`attachments.data` holds the image. `stored_name` is removed. The serving contract is unchanged: requests still address an attachment by `id`, and the stored type still comes from the bytes (ADR-013).

The decisive reason is atomicity, not performance. Row and bytes become one `INSERT` and one `DELETE`, so "a file with no row" and "a row with no file" stop being states the application can reach. The bug class is not made less likely; it is made unrepresentable.

### 2. Backups are one file, taken with `VACUUM INTO`

A backup is a single consistent snapshot of the database, produced without stopping the application. A snapshot that is internally consistent cannot disagree with itself, which removes the second failure mode above along with the first.

### 3. `auto_vacuum = INCREMENTAL` is set, and the setting is verified

With SQLite's default (`none`), deleting rows never returns space to the filesystem. Measured on this project: inserting four 8 MB blobs and deleting all four left the file at 32.1 MB with 8200 free pages. The space is reusable but the file never shrinks, so the database grows for the life of the installation.

With `auto_vacuum` set to `INCREMENTAL` before the first table is created, the same sequence ends at 0.0 MB once `PRAGMA incremental_vacuum` has run.

`page_size` is set to 8192 in the same breath, which SQLite's own guidance names as one of the two best sizes for large BLOB I/O.

**The setting is read back after it is applied, and startup fails loudly if it did not take.** This is not defensive programming. On a database that already has tables, `PRAGMA auto_vacuum = INCREMENTAL` is a **silent no-op** — verified: the value stays `0`, no error is raised, and the space is never reclaimed. Converting an existing database requires running `VACUUM` after the pragma. A configuration line whose failure is invisible is worse than no configuration line, so the value is checked rather than assumed.

### 4. Blobs are served as a stream, not as one buffer

`sqlite3_blob_open` is not available through `bun:sqlite`, so the obvious way to avoid buffering a large image is to read it in slices with `substr()`. Measured, that is a trap:

| Read strategy (8 MB blob) | Time |
|---|---|
| One `SELECT data` | 10 ms |
| 512 KB slices | 114 ms |
| 256 KB slices | 188 ms |

Slicing is **11–19× slower per byte**, because each slice re-walks the BLOB's overflow pages.

Serving therefore streams the blob through a `ReadableStream` in 512 KB chunks. The chunk size is a measured choice, not a round number: it is large enough to avoid the per-slice overhead that makes 256 KB pathological, and small enough that a response holds half a megabyte rather than the whole image. The cost is that streaming is slower than a single read (114 ms against 10 ms for 8 MB), which is the price of not holding every concurrent image in memory. For a local single-user application that is the correct side of the trade, and it is bounded rather than proportional to file size.

### 5. Existing data is converted, and verified before anything is deleted

The migration reads each referenced file, writes its bytes into the row, and compares the byte count against `byte_size`. Only when every row is accounted for is the old column dropped. A file that cannot be read aborts the migration and is reported; no file is deleted on the strength of a partial conversion.

Files on disk with no row are **left alone**. They are unreferenced, so they are invisible to the user, and deleting data the application cannot prove is garbage is not this migration's decision to make. Removing them belongs to the retention pass already tracked in [KNOWN_BUGS.md](../KNOWN_BUGS.md).

## Consequences

**Positive**

- An interrupted upload or a failed delete can no longer leave storage and catalogue disagreeing.
- A backup is one file and cannot be internally inconsistent.
- Reclaiming space is a `PRAGMA incremental_vacuum` away rather than impossible.
- The `checksum` column, which has been written `NULL` since it was created, can be computed at insert time, which makes content-addressed deduplication possible later.

**Negative / accepted costs**

- **The blast radius of database corruption grows.** Today a corrupt database costs the notes, but the image files survive on disk as ordinary files. In the database, one damaged file takes both. Mitigated by `integrity_check` on startup, which is instant even over 100 MB of blobs, and by single-file backups — but it is a genuine reduction in fault isolation, and it is the strongest argument against this decision.
- Streaming costs roughly 10× the time of a single read per image. Accepted to bound memory.
- A blob is capped by `SQLITE_MAX_LENGTH`, which is 1,000,000,000 bytes in this build (verified: 900 MB accepted, 1.5 GB refused). The 50 MB attachment ceiling is four orders of magnitude below it, so the existing limit already prevents this from mattering.
- `auto_vacuum` moves pages rather than repacking them, and SQLite's documentation states it can make fragmentation worse. For an application that writes each image once and rarely deletes, this is acceptable; an application that churned would want periodic `VACUUM` instead.

**Neutral**

- No streaming API was available to reach for, and none is needed.
- Read and write performance showed no meaningful difference from files on this hardware — 10 ms to read an 8 MB blob, 344 ms to write one. Measurements taken under two different heap configurations disagreed on the direction of the difference, so the honest summary is that the two are comparable and the decision rests on atomicity.

## Alternatives considered

**Keep images on the filesystem.** Rejected: it keeps a two-step, non-atomic write and delete, and requires a backup to keep a file and a directory consistent. SQLite's own measurements do favour separate files for BLOBs above 100 KB, and that guidance was re-tested here rather than assumed — but the 2011 Linux figures did not reproduce on this hardware, and even where separate files are faster, "faster to read" does not outweigh "cannot end up in an inconsistent state."

**Use `SQLITE_MAX_LENGTH`-sized blobs with an external content-addressed store.** Rejected: two systems to keep consistent is the problem being removed, not a solution to it.

**Read a blob in slices to avoid buffering it, using `substr()`.** Rejected on measurement: 11–19× slower than a single read.

**Serve the whole blob as one buffer.** Rejected: peak memory per in-flight request would be the full image size, so a note with several large images multiplies it.

**Delete the orphaned files during the migration.** Rejected: the application cannot prove a file is unreferenced rather than merely unreferenced *so far*, and content loss is not a side effect a storage migration should risk.

## What was measured, and how

Every figure in this ADR was produced on the development machine against this project's schema, with Bun 1.4.2 and SQLite 3.53.2, rather than taken from documentation:

| Measurement | Result |
|---|---|
| `auto_vacuum` unset, 32 MB inserted then deleted | file stays 32.1 MB, 8200 free pages |
| `auto_vacuum` incremental, same sequence | 0.0 MB after `incremental_vacuum` |
| `PRAGMA auto_vacuum` on a populated database | stays `0`, no error; requires `VACUUM` |
| Single 8 MB blob read / write | 10 ms / 344 ms |
| 8 MB read: one read vs 512 KB vs 256 KB slices | 10 ms / 114 ms / 188 ms |
| `VACUUM INTO` a 100 MB database | 267 ms, `integrity_check` ok |
| `integrity_check` over 100 MB of blobs | ok, effectively instant |
| Blob vs file serving, 8 MB, 20 iterations | comparable; direction changed with heap size |
