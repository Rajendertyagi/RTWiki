# ADR-020: Search Storage and the Import Conversion Boundary

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-09-30 |
| **Deciders** | Project Owner, Lead Developer |
| **Affects** | [ADR-018](ADR-018-documented-vs-built.md) (rows 5 and 6 — see *Supersedes*), [ADR-002](ADR-002-bun-hono-sqlite.md) (its FTS5 requirement, via ADR-018) |
| **Supersedes** | The search-mechanism and import-adapter findings of [ADR-018](ADR-018-documented-vs-built.md). ADR-018 itself is **not** edited; its historical rows stand as written |

## Context

[ADR-018](ADR-018-documented-vs-built.md) audited the documentation against the code and
recorded where the two disagreed. Two of its findings were still describing an earlier
state of this repository rather than the present one, and both were the kind of
disagreement that costs an agent real time: read literally, they say the search feature
works one way and that a whole module of RTWiki is missing.

**Finding 5 said search uses FTS5.** It recorded that `GET /api/search` and a
`SearchService` class had zero matches, that search really lives at `GET /api/pages?q=`,
and that it uses `LIKE` — "not FTS5". That remains true. What has since changed is the
*documentation*, which continued to assert FTS5 as the search technology in
[ARCHITECTURE.md](../ARCHITECTURE.md) §3.6, and which described the FTS5 table as though
triggers maintained it.

**Finding 6 said no import or adapter module exists.** It recorded "0 matches. No import,
adapter or sanitise module exists" for the eight-stage shared import pipeline that
[ADR-006](ADR-006-rich-content-and-import-contract.md) specifies and two documents
describe as delivered. That finding is **still true of the pipeline** and is *not*
superseded by this record. It has become partly inaccurate only in a narrow sense: an
adapter boundary now exists for the conversion step, which is a different thing from the
pipeline ADR-006 describes.

Two things made the drift worth an ADR rather than a quiet edit. First, `search_index_fts`
is a real table created by migration `001` and read by nothing, so a reader who trusts
either document is wrong about a mechanism that exists in the schema. Second, ADR-018 is
**Accepted**, and this repository's own rule is that an accepted ADR is changed only by a
superseding ADR — so the correction has to be a record, not an edit.

## What the code actually does

Both statements below were verified against the source rather than inferred from prose.

### Search

- The live table is **`search_index`**, an ordinary SQLite table of
  `page_id`, `title`, `content`.
- Search is `GET /api/pages?q=`, and the query is a **`LIKE`** match:
  `WHERE p.deleted_at IS NULL AND (si.title LIKE ? OR si.content LIKE ?)`
  (`page-repository.ts:397`, `:406`).
- `content` holds readable text derived from the page's own content **plus the extracted
  text of every document the page references** (ADR-015). One page produces one row, so a
  note appears once in results however many documents it holds.
- **There is no `SearchService`.** The class does not exist in `src/`, `tests/` or
  `scripts/`, and never has.
- `search_index_fts` exists. Migration `001` creates it as an external-content FTS5 mirror
  (`content='search_index'`, `content_rowid='page_id'`). It is **never written, never
  read, never queried, and no triggers maintain it** — no migration creates a trigger, and
  a migrated database reports none.

### Import conversion

- `src/shared/import/conversion.ts` provides a **conversion boundary**: an identified
  import source in, editable RTWiki content out.
- It is **format-neutral**. A converter is an entry in `CONVERSION_ADAPTERS` declaring the
  allowlist keys it handles and a `convert` function; it produces a stored content string
  and a page type, never editor objects, so the boundary cannot drift when the block set
  changes.
- It is exercised by **one** real path today: the Markdown import, which calls the boundary
  and passes the result to the existing page creation.
- It deliberately implements **only** Markdown. A DOCX, PDF, XLSX or ODT returns
  `unsupported_conversion` and remains an **attachment** with its text extracted for search
  — the shipped behaviour of ADR-015, unchanged.
- The **eight-stage pipeline of ADR-006 does not exist.** This boundary is the conversion
  step and nothing else. There is no manifest validation, no transactional package import,
  no asset localisation, and no note-package route.

## Decision

1. **Search is `search_index` queried with `LIKE`, and is described that way.**
   [ARCHITECTURE.md](../ARCHITECTURE.md) §3.6 and [DATA_MODEL.md](../DATA_MODEL.md) §3.6
   now state the table, the mechanism, and the lifecycle.

2. **`search_index_fts` is retained, unused, and is not described as active.**
   Removing it is not authorised here. It is a near-empty external-content table, not a
   running cost, and its removal would need a migration justified on its own terms.

3. **Switching search to FTS5 is a separate decision, not an implementation detail.**
   It would change tokenisation, ranking and partial-word matching, and `LIKE '%term%'` is
   what the current results and tests are written against. Its cost is known and recorded:
   `LIKE '%term%'` cannot use an index, so search is a full scan of the index, bounded by
   the row-size cap.

4. **There is one search-index computation point.** `searchContentForPage` composes a
   page's own text with its referenced documents' text for every create, update, duplicate
   and reindex, so the lifecycle is correct by construction rather than by remembering to
   re-index at each call site. The one mutation that is not a page change — deleting the
   attachment itself — is handled explicitly by the attachment route.

5. **The conversion boundary stays small.** It is one module and one registered list. It
   grows by adding a converter, not by adding stages. If it ever needs to be a pipeline,
   ADR-006 is the record that has to change first.

6. **DOCX editable conversion is not implemented and is not implied.** Documents are
   attachments. Converting one would change what an attachment *is*, which is a product
   decision for a future phase with its own ADR.

## Supersedes

Precisely, and only this much of [ADR-018](ADR-018-documented-vs-built.md):

| ADR-018 item | Status now |
|--------------|-----------|
| Row 5 / finding 5 — the `SearchService` and FTS5 claims as *current* description | **Superseded.** Search is `search_index` with `LIKE`; there is no `SearchService`; `search_index_fts` is unused and untriggered |
| Row 6 / finding 6 — "No import, adapter or sanitise module exists" | **Partly superseded, narrowly.** A conversion *adapter* now exists. The eight-stage pipeline still does not, and finding 6 stands for the pipeline |
| Rows 1–4 and 7–12, including the "service classes" row | **Unchanged.** Not addressed by this record. Note that removing the fictional class names from ARCHITECTURE.md §3.4 makes that row *more* accurate, not less: there are still no `PageService` / `SearchService` / `AttachmentService` / `ImportService` / `BackupService` classes |

ADR-018 is left exactly as written. Where its rows and this ADR disagree, this ADR is
authoritative for search and conversion.

[ADR-002](ADR-002-bun-hono-sqlite.md) remains **Accepted** and historically inaccurate
about FTS5 and Drizzle. It carries its own supersession banner and this ADR does not
rewrite it; its FTS5 requirement is the origin of the unused table, which is why the table
is documented rather than quietly dropped.

## Alternatives Considered

- **Delete `search_index_fts` now.** Rejected: it is not causing a measurable cost, and a
  migration that drops a table needs its own justification rather than riding along on a
  documentation change.
- **Activate FTS5 while correcting the docs.** Rejected: it changes matching and ranking
  behaviour, which is a different decision with different evidence. The docs correction
  does not depend on it.
- **Let the docs stay wrong and rely on ADR-018.** Rejected: ADR-018 is an audit that
  already found this, and a reader who has not read it is misled twice over.
- **Build the full eight-stage pipeline now.** Rejected as out of scope. The conversion
  boundary is the one seam that earns its place today; the rest of ADR-006 remains
  unbuilt and documented as such.
- **Make the conversion boundary a framework with stages and a registry on disk.** Rejected:
  one converter does not justify a framework. A future DOCX or HTML converter is one array
  entry.

## Consequences

- ARCHITECTURE.md, DATA_MODEL.md, HANDOVER.md, BACKUP_PLAN.md and MVP_SCOPE.md describe
  search the way it is built.
- A new format-specific converter can be added without touching the importer, the editor or
  page creation.
- The eight-stage import pipeline stays visibly unbuilt. This ADR does not make that
  smaller.
- Search does not scale with the corpus, and this record is where that cost is stated.

## Risks

- **A reader treats "unused FTS5 table" as a recommendation to adopt FTS5.** Mitigated by
  stating that adopting it is a separate decision with behavioural consequences.
- **The conversion boundary is mistaken for the ADR-006 pipeline.** Mitigated by stating in
  three places — here, in the module header, and in [MVP_SCOPE.md](../MVP_SCOPE.md) — that
  only the conversion step exists.
- **Superseding ADR-018 piecemeal leaves it partly believed.** Accepted knowingly: a
  narrow, explicit table of what changed is more honest than a broad rewrite, and ADR-018's
  remaining rows are still correct.

## Revisit Conditions

- Search becomes slow enough that a full index scan is measured to matter, or an
  FTS5-backed search is adopted and its behaviour documented.
- A second converter is added — at which point the boundary's shape is re-earned rather
  than assumed.
- The ADR-006 pipeline begins to be built.

---

## See also

- [ARCHITECTURE.md](../ARCHITECTURE.md) — §3.4, §3.6
- [DATA_MODEL.md](../DATA_MODEL.md) — §3.5, §3.6
- [ADR-018](ADR-018-documented-vs-built.md) — the audit this partly supersedes
- [ADR-006](ADR-006-rich-content-and-import-contract.md) — the import contract, still unbuilt
- [ADR-015](ADR-015-document-attachments.md) — documents as attachments, with extracted text
