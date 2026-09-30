# ADR-019: One Mermaid Page, One Mermaid Block

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-09-29 |
| **Deciders** | Project Owner, Lead Developer |
| **Affects** | [ADR-012](ADR-012-diagram-rendering-and-sanitisation.md) (template list and layout policy), [ADR-006](ADR-006-rich-content-and-import-contract.md) (one block, not two) |

## Context

RTWiki shipped two Mermaid page types and two Mermaid block types. The duplication
was never designed; it accumulated, and it was only visible once the two were read
side by side:

- **The pages differed by one line.** `mermaid-workspace.tsx` chose between them with
  a single ternary, and the only other difference was which of two starter strings a
  new page began from. The workspace, the canvas, the toolbar, the zoom controls and
  the secure render pipeline were all shared.
- **The blocks differed by one line too.** `blocks/diagram.tsx` and
  `blocks/mindmap.tsx` were each 39 lines, identical in their imports, their
  `propSchema`, their resize handler and their view, differing only in the type name
  they declared. `mindmap.tsx` said so itself: *"rendering shares the exact same
  secure Mermaid pipeline and security"*.
- **Mind map was already a template.** `DIAGRAM_TEMPLATES` contained a `mindmap`
  entry. Mermaid's `mindmap` is an ordinary diagram type, so the dedicated block and
  page type duplicated something the template list already held.

The user-visible cost was worse than the maintenance cost. Inserting "Diagram" from
a rich note dropped a generic two-box flowchart, and the 21 template types were only
reachable from a bar inside a block the user had to insert first. Typing `/sequence`
found nothing. The owner asked for the duplication to be removed and one good
working implementation kept.

One real behavioural difference did survive the file comparison, and is preserved
below: `mindMap` blocks render **zoom controls** and `diagram` blocks do not
(`mermaid-block-view.tsx`). That is a difference in the shared view keyed on the
block type, not a difference between the two spec files.

## Decision

1. **The Mind Map page type is retired.** `PageType` and the page-type enum no
   longer contain `mindmap`; the Diagram page is the only dedicated Mermaid page.
2. **The `mindMap` block type is retained for reading only.** It is registered in
   the editor schema and nothing offers it. A document written while it was offered
   still contains the block, and removing the type would have made
   `containUnknownBlocks` rewrite it into a code block holding its JSON — a silent
   change to the user's own content on the next autosave.
3. **One implementation, two registered names.** `blocks/mindmap.tsx` is deleted.
   Both names are built by `createReactMermaidSpec` in `blocks/diagram.tsx`, so the
   two cannot drift. Zoom controls stay attached to the documents that have them.
4. **Existing rows are migrated, not deleted.** Migration
   `010_mindmap_pages_to_diagram` rewrites `page_type = 'mindmap'` to `'diagram'`.
5. **A stored page's own inner `type` marker is normalised on read, not rewritten.**
   The page JSON records its type independently of the column, so narrowing the read
   schema would reject a migrated page's content. `parseVisualPageContent` accepts the
   retired value and reports it as `diagram`. This avoids a second rewrite in SQL that
   could fail in a second, separate place.
6. **Mermaid insertion in a rich note is a chooser over the shared template list.**
   The Diagram toolbar control opens a menu of every template rather than inserting
   a fixed starter, and a Mermaid mind map is one of those options. The list is read
   through `diagramTemplateOptions` in `blocks/diagram-template-bar.tsx`, which is
   also what the Diagram page's template bar reads, so the two surfaces cannot offer
   different diagrams.
7. **Mermaid is not offered in the slash menu.** An `InsertEntry` declares which
   surfaces offer it, and the slash menu keeps the entries that include `slash`. A
   slash menu lists block types; thirty-odd Mermaid templates are not block types.

## Alternatives Considered

**Delete the `mindMap` block type outright.** Simpler, and it removes the alias. It
also rewrites existing documents into JSON-bearing code blocks on their next save.
The owner has no Mind Map pages to lose, but the cost is not "lose the page type" —
it is "silently rewrite the content of any note that contains the block", which
[AGENTS.md](../../AGENTS.md) §4 forbids. The alias costs 39 lines in one file and
loses nothing.

**Keep the Mind Map page as a preset.** Leave the page type and have it create a
Diagram page holding a mind map. Rejected: a page type that is a synonym for another
is exactly the duplication being removed, and the stored `type` marker would still
have to be migrated anyway.

**Put the 21 templates into the slash menu too.** Rejected for discoverability, not
principle: a slash menu is a block-type list, and filtering thirty templates by name
in it makes the common case — "I want a sequence diagram" — slower than the toolbar.

**Give the Diagram block zoom controls as well.** Tempting, and it would make the
zoom feature reachable from new content. Deliberately not done here: it is a change
to the block's behaviour for every existing diagram, and it is not part of removing a
duplicate.

## Consequences

**Easier.** One Mermaid page type, one block implementation, one template list. A new
person editing the editor finds one file, not two that must be changed together. The
rich note offers the whole template library at the point of insertion, which is what
the Diagram page has always had.

**Harder, slightly.** The `mindMap` name still exists in the schema, the icon union's
former sibling in the view's `blockType` prop, the search extractor's withheld-source
list, and the preview text's source-only set. Each is commented, and each is there so
existing documents keep working. Removing them is a separate change that should
follow a migration of the stored block JSON.

**User-visible behaviour changes.** The New Page dialog, the tree context menu, the
page-type badge, the page-type icon, the trash view, the dashboard card, the
dashboard preview and the page tree no longer mention a Mind Map. A mind map is drawn
by choosing the `mindmap` template.

## Risks

**A page that is somehow still `mindmap`.** `page_type` is a plain `TEXT` column with
no `CHECK` constraint, so nothing ever prevented such a row, and the page-type enum
guards the whole page response — one stale row would fail the list, not just its own
page. Mitigated by migration `010`, and by three browser tests asserting that no
creation path offers a Mind Map page, so the row cannot be recreated. A row that
survives anyway is rejected rather than silently coerced, which is deliberate.

**A stored page JSON that still says `mindmap`.** Mitigated by reading it and
normalising it (decision 5) rather than by a SQL rewrite, so there is no second
failure mode. Covered by unit tests for both the v1 and v2 stored shapes, and by one
that proves an unknown marker is still rejected.

**A second Mermaid template list appearing.** Mitigated by
`diagramTemplateOptions` being the only reader of `DIAGRAM_TEMPLATES` for a menu, and
by a browser test comparing the chooser's offered ids against `DIAGRAM_TEMPLATES` — so
a template added to the list and not to the chooser fails the suite.

**The alias outliving its purpose.** It is dead weight once no document holds the
block. That is not detectable from the code and is not worth guessing at; the
retirement condition is below.

## Revisit Conditions

- Every stored document has been rewritten from `mindMap` blocks to `diagram` blocks.
  Then remove `createReactMindMapSpec`, the `mindMap` schema key, and the
  `blockType` branches in the view — in one change, and only with a migration that
  rewrites the stored block JSON.
- A user asks for the zoom controls on `diagram` blocks. That is a separate decision
  about the block's behaviour, not about this duplication.
- Mermaid's `mindmap` stops being a first-class diagram type, which would make the
  template route untenable and force a dedicated block back into being.
