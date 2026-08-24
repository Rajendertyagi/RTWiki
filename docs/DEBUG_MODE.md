# Debug Mode — Structured Client Diagnostics

Debug Mode is an **opt-in** diagnostic facility that records structured,
content-free client events while you reproduce a problem. It is off by
default, never required for normal use, and can never record note content.

## Enabling Debug Mode

1. Click the **gear (Settings)** icon at the bottom of the left utility rail.
2. Toggle **Debug logging** on. The rail icon turns teal and the popover shows
   an active indicator while it runs.
3. Reproduce the problem.
4. Toggle it off again (or just close the app — the log is bounded either way).

The toggle persists locally across restarts. No debug overlay appears in
ordinary use.

## Where the log lives

Events are written to a rotating JSON Lines file beside the other runtime
data (portable layout, [ADR-005](adr/ADR-005-portable-data-layout.md)):

```text
RTWiki/
├── data/
└── logs/
    ├── rtwiki.log              # application log (always on)
    └── rtwiki-debug.jsonl      # Debug Mode events (opt-in)
```

- One JSON object per line; rotation keeps the current file plus three
  rotated files, each bounded in size.
- Ingestion is localhost-only: the browser posts batches to
  `POST /api/client-debug-events`, which validates every event against a
  strict shared schema and **rejects unknown fields**.

## What is recorded — and what never is

Every event carries only allowlisted fields:

| Field | Meaning |
| --- | --- |
| `ts` | Client timestamp |
| `session` | Debug session ID (new per enable) |
| `cat` / `evt` | Category and event name (closed allowlists) |
| `pageId` / `targetId` / `tabId` | Page/row identifiers |
| `field` | View: `preview`, `html`, `css`, `javascript` |
| `rev` / `gen` | Autosave revision / draft or render generation |
| `len` | Source length in characters |
| `hash` | 8-hex FNV-1a fingerprint of source (non-reversible) |
| `durMs` | Duration |
| `result` | `ok`, `error`, `cancelled`, `rejected`, `stale`, `skipped` |
| `code` | Bounded machine token (e.g. drop edge, error code) |

**Never recorded:** note content, HTML/CSS/JavaScript source, titles, DOM
text, aria-labels, input values, passwords, clipboard contents, or arbitrary
metadata. The schema has no field that could carry them, and unknown fields
are rejected server-side rather than stripped.

Event categories: `ui`, `editor`, `autosave`, `preview`, `navigation`,
`error`. The authoritative allowlists live in
`src/shared/schemas/debug-events.ts`.

## Behavioural guarantees

- Off by default; enabling requires explicit action in the UI.
- Events are batched (≈2 s cadence), size-bounded, and dropped oldest-first
  under load; ingestion failures are swallowed, and repeated failures stop
  sending for the session. Logging can never break editing.
- The endpoint enforces same-origin checks, payload caps, rate limits, and
  schema validation; there is no endpoint that can read logs back.

## Using Debug Mode to diagnose

Typical investigations:

- **Lost typing after subfile switches** — look for `editor_transaction`
  generations around `autosave_request_started` / `autosave_revision_applied`;
  with the current draft contract, autosave responses can no longer rewind
  the draft (`editor_stale_update_rejected` marks any defensive rejection).
- **Blank preview after returning to the parent** — correlate
  `editor_source_switch_completed` (`field: "preview"`) with
  `preview_render_built` / `preview_iframe_ready` generations.
- **Drag-and-drop feedback** — `ui_drag_hint_changed` fires only when the
  highlighted row/edge changes; `ui_drag_drop` records the committed edge.
- **Rename corruption** — `ui_rename_start` / `ui_rename_commit` carry the
  real page ID that was renamed.

## Confirmed behaviour (stability iteration)

These behaviours are implemented and covered by unit and browser tests:

- **One draft per open HTML page.** All v2 fields (HTML/CSS/JavaScript/JS
  gate) live in a single in-memory draft keyed by the real parent page ID.
  Switching source subfiles never recreates it, autosave responses can never
  rewind it, and returning to the parent renders it synchronously.
- **Refresh Preview.** The rendered parent view has a Refresh action that
  rebuilds the sandboxed frame from the current draft without reloading the
  browser or changing the selection.
- **Workspace restoration.** A normal browser refresh reopens the previous
  tabs, active page, and active HTML view (preview/source) from
  sessionStorage metadata. Only IDs are stored — never content. Invalid IDs
  fall back to Home.
- **Rename integrity.** Tree and page-header renames share one
  `(pageId, title)` controller path; the entered title is applied everywhere
  (tree, tab, header, dashboard card), cancel changes nothing, and virtual
  subfiles cannot be renamed.
- **Visible drag targeting.** Before/after drops show an insert line, inside
  drops highlight the target row, and all feedback clears on leave, cancel,
  Escape, failure, and drop. Virtual subfiles are never valid sources or
  targets.
- **Control placement.** The JavaScript enable gate lives only in the
  JavaScript subfile with compact sandbox help; the rendered parent shows
  only page content plus Refresh Preview.

## Related documents

- [Security](SECURITY.md) — localhost binding and logging privacy rules
- [Development Standards](DEVELOPMENT_STANDARDS.md) — define-once constants
  (log filenames, bounds, and limits live in `src/shared/constants/index.ts`)
