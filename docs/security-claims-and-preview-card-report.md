# Verification Report: Security Claims and the Empty Dashboard Card

> Date: 2026-09-27
> Branch: `docs/security-claims` (forked from `docs/adr-018-documented-vs-built`)
> Commits: `4313fc6` (documentation truth) · `59b46b2` (the empty card)
> Scope: Two false "Verified" labels in `AGENTS.md` §9; a table-only page rendering an empty dashboard card; three places disagreeing about what text a page contains.

---

## Executive summary

Two things happened, in this order because the first is the governing file.

**First, a documentation truth pass.** Three "Verified" labels had been attached to claims that were only
*partly* true. A label like that is worse than no label, because every future agent reads it as a
guarantee. Two of the three were genuinely false:

- `MAX_REQUEST_SIZE` was listed as an enforced request limit. It is **dead configuration** — declared,
  imported, typed, assigned, and read by nothing.
- `Cache-Control` was described as set "per response", implying whole-surface coverage. It is set at
  exactly four sites, and the **entire JSON API** returns page data with no cache directive at all.

`AGENTS.md` §13 now carries the rule that would have prevented both: *Verified* requires full enforcement,
a partial control gets enumerated half by half, and **"defined" is not "enforced"**.

**Second, a user-visible bug.** A page whose only content is a table rendered an **empty card** on the
dashboard while being perfectly searchable. To a user, that reads as a broken or empty page. Fixing it
surfaced two more divergences in the same family, plus a fourth defect nobody had reported: preserved
unknown-block JSON was being shown on dashboard cards in plain sight.

**The theme of both commits is one page disagreeing with itself** — sometimes with its own search index,
sometimes with its own status bar. Three separate code paths answered "what words does this page contain?"
and gave three different answers.

| Item | Before | After |
|---|---|---|
| Table-only page, dashboard card | `""` — empty | `Header A Header B Cell one Cell two` |
| Image-caption-only page, search | `""` — unfindable | caption indexed |
| Stored `codeBlock` array form, search | `""` | text indexed |
| Preservation-marker payload, card | shown in full | withheld |
| Rich Note word count vs status bar | could differ, same page | one shared reduction |

---

## Part 1 — The two false verifications

### 1a. `MAX_REQUEST_SIZE` enforces nothing

`AGENTS.md:161` claimed it was an enforced limit. Every occurrence in the codebase:

| Location | What it is |
|---|---|
| `src/shared/constants/index.ts:16` | `export const MAX_REQUEST_SIZE = 100 * 1024 * 1024` |
| `src/server/config/index.ts:13` | imported |
| `src/server/config/index.ts:30` | `maxRequestSize: number` — typed |
| `src/server/config/index.ts:53` | `maxRequestSize: MAX_REQUEST_SIZE` — assigned |

**Nothing reads it.** No request path consults it, so no request is bounded by it. It looks like a control
and does nothing.

**What actually enforces limits:**

| Control | Enforced by |
|---|---|
| Upload size | `bodyLimit`, `src/server/attachments/attachment-routes.ts:6,144` — rejected before the body is buffered |
| Page JSON body | `MAX_PAGE_JSON_BODY_BYTES` (4 MB), `src/shared/constants/index.ts:20` |
| Per-pane HTML/CSS/JS | `src/shared/schemas/html-content.ts:29-31`, genuinely live via `byteBoundedString` at `:39-47` |

### 1b. `Cache-Control` is not set on any API response

`AGENTS.md:162` named four sites — and those are exactly the four that exist. The problem is what they cover.

**Covered:**

| Site | Value | Why |
|---|---|---|
| `src/server/static.ts:113` | `no-store` | The SPA document; stops a stored body being paired with a later response's CSP nonce |
| `src/server/static.ts:204` | `public, max-age=31536000, immutable` | Hashed asset filenames |
| `src/server/attachments/attachment-routes.ts:214` | `private, no-cache` | Attachments are addressed by id |
| `src/server/attachments/attachment-routes.ts:282` | `private, no-cache` | The second serving route |

**Not covered — the entire JSON API:** `GET /api/pages`, `GET /api/pages/:id`, `GET /api/pages?q=`,
`GET /api/attachments/:id/text`, and the `onError` (`app.ts:213`) and `notFound` (`:218`) handlers all
return page or error data with **no cache directives at all**. `src/server/routes/pages.ts` contains zero
occurrences of the word `cache`.

An additional finding worth recording: **Hono's `secureHeaders` sets no `Cache-Control` of its own** —
verified in `node_modules/hono/dist/middleware/secure-headers/secure-headers.js`, where the string is absent
from both `HEADERS_MAP` and `DEFAULT_OPTIONS`. So it cannot be covering that header either.

**Risk, stated honestly:** private page content sitting in a shared cache. This is **latent** in the default
configuration — the server binds loopback only, so there is no shared cache to leak into — and it becomes
live the moment LAN binding is authorised. It must be closed *before* that phase, not during it.

### 1c. The rule that prevents recurrence

Added to `AGENTS.md` §13:

> **"Verified" requires full enforcement, and only for the claim as written.** Write it when the whole
> statement holds. Where a control is partial, enumerate what *is* and *is not* enforced and name the file
> for each — never round a partial check up to a whole one. A label on a partly-true claim tells every
> future agent a protection exists when it does not, which is worse than no label. **"Defined" is not
> "enforced":** a constant that is declared, exported, typed and assigned but read by nothing is dead
> configuration, and must be labelled as such rather than cited as a limit.

No security requirement was deleted. Every normative rule in §9 was preserved verbatim; only factual claims
changed, and each now names the file that enforces it.

---

## Part 2 — A table-only page renders an empty card

### The bug

A table block's text lives at `content.rows[].cells[].content` — a nested **object**, not an array.
`page-preview-text.ts` descended into `content` only when it was an array, so it never saw a single cell.

Measured on a page whose only content is a two-row table:

| Consumer | Before | After |
|---|---|---|
| search extraction | `Header A Header B Cell one Cell two` | unchanged |
| dashboard card | `""` | `Header A Header B Cell one Cell two` |

This is the **mirror image** of the search-recursion defect fixed in `934f151`: search walked into tables,
the preview did not.

### Two more divergences, found while fixing it

- **Image captions.** The preview indexed `props.caption`; search did not. A page whose only prose is
  captions was visible on a card and **unfindable**.
- **The stored `PlainContent` array form.** A stored `codeBlock` serialises its text as an inline array, but
  `collectOwnBlockText` accepted only `typeof content === 'string'`. Search returned `""` where the preview
  returned the text. The pre-existing test used only the *partial* string form, which is exactly why it was
  never caught.

### A fourth defect, unreported until now

The **preservation-marker payload** was reaching dashboard cards in plain sight —
`[unsupported block preserved below] {"type":"futureBlock"}` — putting the containment mechanism on screen.

Worse, fixing the array-form bug made the server side leak too: the existing `startsWith` check stopped
working, because a stored codeBlock serialises the marker and the JSON as **separate inline nodes**. Checking
the joined text afterwards was too late. Both consumers now check the marker *before* emitting anything, and
both check the inline-array form.

### Red output, before the fix

11 of 16 tests failing. The reported case, verbatim:

```
error: expect(received).toBe(expected)
Expected: "Header A Header B Cell one Cell two" Received: ""
```

Others:

```
Expected: "Revenue by quarter, 2024"   Received: ""
Expected: "const real = 1"            Received: ""
Expected: "the spec"                  Received: ""
```

and the kitchen-sink equality, which surfaced the code block I had not considered:

```
Expected: "... const stored = true Closing paragraph."
Received: "... const stored = true const partial = true Closing paragraph."
```

**After: 94 pass, 0 fail** across the six affected files.

### A divergence in my own first fix

Worth recording, because the equality assertion is what caught it. I initially passed `depth + 1` to the
inline reader, which made the preview's depth cap land one level *earlier* than the server's — so at depth 64
the same page was readable by search and not by the preview. The two caps must land on the same document, so
the preview now passes `depth`, matching `collectInline(block.content, out, depth)`.

Measured, both sides level by level, after the fix:

| Nesting levels | search reads leaf | preview reads leaf |
|---|---|---|
| 62, 63, 64 | yes | yes |
| 65, 66 | no | no |

---

## Part 3 — The three conventions, reconciled

| Consumer | Before | Now |
|---|---|---|
| `search-extraction.ts` | recursed into `children` and table cells (fixed in `934f151`) | one shared reduction |
| `page-preview-text.ts` | recursed, but missed table cells and the array code form; **leaked** marker payloads | one shared reduction |
| `rich-editor.tsx:52-68` word count | **top-level blocks only**, comment calling it deliberate | one shared reduction |

The word count was the quiet one. The Rich Note's own count and the status bar's count — both on screen, both
for the same document — could report different numbers, because one walked nested content and the other did
not. Its comment claimed the shallowness was deliberate. It was not deliberate, it was inconvenient, and it
was the same defect in a third place.

### Decision: aligned, with the cost measured

`richBlocksPlainText` is now exported from `page-preview-text.ts` and `countBlockWords` calls it.

The count runs on **every keystroke**, so the cost was measured rather than assumed (Bun 1.4.2, 200 runs
after warm-up):

| Document | was | now | `JSON.stringify` already in the same handler |
|---|---|---|---|
| 150 blocks (19 kB) | 0.02 ms | 0.08 ms | 0.04 ms |
| 800 blocks (100 kB) | 0.03 ms | 0.20 ms | 0.11 ms |
| 2,500 blocks (314 kB) | 0.20 ms | 1.87 ms | 0.62 ms |
| 12,000 blocks (1.5 MB) | 0.98 ms | 11.67 ms | 5.14 ms |

**The trade, in plain terms:** sub-millisecond for any realistic study note. The last row is a 1.5 MB
document, and that handler *already* spends 5.1 ms there serialising the document for autosave — the walk is
not what makes such a page slow, and it stays inside a 16 ms frame to roughly 10,000 blocks, which is a
document nobody writes. **A slightly slower count that is right beats a fast one that disagrees with the
number printed beside it.**

### The depth guard

The preview walk gained `PREVIEW_MAX_BLOCK_DEPTH = 64`, deliberately equal to the server's
`SEARCH_MAX_BLOCK_DEPTH`, with the same defined behaviour: **read to the cap, keep everything already
collected, stop, never throw.**

The client cannot import the server constant, so the equality is **asserted by a test**, not assumed. The
guard is needed because a page body arrives over the network and rich content is not validated server-side;
without it, a hand-edited document nested without bound would exhaust the stack while the dashboard was
merely drawing a card.

---

## The assertion that stops the drift

`tests/search-preview-equality.test.ts` walks **one document covering every block type** through both
consumers and asserts the strings are **equal** — plus a **flat** document, so the assertion is not an
artefact of nesting.

Block types covered: paragraph, heading, nested bullets, numbered item with a child, checkbox item, callout,
quote with a link, table, table nested under a bullet, image with a caption, `codeBlock` in **both** stored
forms, divider, and a closing paragraph.

Also asserted: both withhold formula source, and both withhold the preservation-marker payload.

A future divergence is now a red test rather than a user's dashboard.

---

## Gates

| Gate | Result |
|---|---|
| `bun run typecheck` | **17 errors, 0 of them mine** — all in `tests/page-write-concurrency.test.ts`, another agent's untracked in-flight file. Reported, not fixed |
| `bun run format:check` | 325 files, no fixes applied — clean |
| `bun run lint` | **62 warnings / 0 errors** — baseline held. The 3 warnings in `rich-editor.tsx` confirmed pre-existing by stashing my change |
| `bun scripts/verify-docs.ts` | **PASS** — 48 files, 447 links, 0 failures, 0 warnings |
| Targeted `bun test` | **94 pass, 0 fail** across six affected files |

Not run: Playwright, any build, any server or process. `build/web` untouched. Nothing pushed.

---

## Found, reported, not fixed

| Finding | Why not fixed |
|---|---|
| `MAX_REQUEST_SIZE` is dead configuration | A finding, not a fix, per the brief |
| No `Cache-Control` on the JSON API | Unbuilt security work; recorded in `AGENTS.md` §9 and `SECURITY.md` §5.0 |
| `PREVIEW_MAX_BLOCK_DEPTH` is a second constant, not an import | The client cannot import from a server module; equality is test-asserted instead |

## Cross-references

- [KNOWN_BUGS.md](KNOWN_BUGS.md) — both defects recorded with their measurements
- [SECURITY.md](SECURITY.md) — the `Cache-Control` and request-limit corrections
- [ADR-018](adr/ADR-018-documented-vs-built.md) — the precedent: where a document and the code disagree, the code is authoritative
