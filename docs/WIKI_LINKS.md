# Internal Links & Discovery

RTWiki functions as a connected personal wiki: pages link to each other by
stable identity, backlinks are indexed exactly, and any page is reachable in
two keystrokes through the global finder.

## Internal page links

An internal link is an ordinary Rich Note link mark whose href carries the
application-owned target identity:

```
rtwiki://page/<pageId>
```

The href is a plain string attribute, so the editor preserves it verbatim
through every save/load round-trip and through external HTML export. Because
the stored identity is the page **ID** (a UUID minted at creation):

- Renaming a page never breaks links to it.
- Deleting a target leaves the source link intact but visibly broken.
- Recreating a page with the same title can never silently reconnect an old
  link — only the original ID would.

### Insertion paths

- **`[[` picker** — typing two opening brackets near the caret opens a
  searchable page list: filter as you type, Arrow keys navigate, Enter
  inserts, Escape closes, explicit empty state. Pages are never created
  implicitly.
- **Toolbar action** — the always-visible *Link to page* control opens the
  same picker; it applies to the selected text when one exists, otherwise
  inserts the target page's title as the link text.

### Navigation and broken links

Clicking an internal link routes through the controller flow: pending edits
flush first, tabs deduplicate, and no browser navigation occurs. If the
target was deleted, the link renders struck-through (its stored ID is kept),
clicking shows a short notice instead of navigating, and the link can be
removed or re-pointed like any other text. Restoring/recreating a page with
the same title does not reconnect old links.

## Backlinks

Migration `004_page_links` maintains an exact relationship index:

```sql
CREATE TABLE page_links (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id)
);
CREATE INDEX idx_page_links_target ON page_links(target_id);
```

There are deliberately no foreign keys: links to deleted targets must
survive as broken links, and deleting a linked target is never blocked. The
index is maintained transactionally on every successful write — rich content
replaces the outgoing set (extracted from real link marks only; plain text
resembling the scheme, external URLs, and unsupported-block preservation
payloads are never indexed), non-rich page types clear their outgoing set,
duplicates copy theirs, and soft-deleting a page drops its outgoing links
while incoming ones survive.

The right sidebar lists living backlinks (newest-modified first) with a
readable snippet around each link occurrence, an explicit "No pages link
here" empty state, and refreshes automatically when the open page is saved.

## Ctrl+K finder

The global finder opens from every surface (dashboard, Rich Notes, HTML IDE,
Diagram/Mind Map workspaces). Results are grouped **Recent / Title matches /
Content matches** with cross-group deduplication: title filtering is
immediate over the loaded collection while content matching reuses the
existing search endpoint behind a short debounce. Up/Down navigate, Enter
opens through the controller flow, Escape closes without leaving any overlay.

Ctrl+K conflict rule: none of the installed CodeMirror keymaps bind Mod-K,
so the finder is safe to summon globally, including inside source editors.

## Recent pages

Recently opened pages are bounded client-side metadata in `localStorage`
(maximum 20 entries, newest first). Only genuine opens are recorded;
dashboard/home never appears; virtual HTML subfiles count as their parent
page; deleted IDs are discarded when resolved against the living collection;
and `updated_at` is never touched.
