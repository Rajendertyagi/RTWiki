import { UI_TEXT } from '../../config/index.js'
// From the catalogue, NOT from `./blocks/diagram-template-bar.js`. The component
// re-exports these names, but importing it from here would drag its
// `.module.css` back into any Node-side consumer - which is exactly how
// `tests/browser/diagram-templates.pwspec.ts` came to fail parsing a stylesheet
// as JavaScript. Data must be imported from the module that owns the data.
import {
  type DiagramTemplateOption,
  diagramTemplateOptions
} from './blocks/diagram-template-catalog.js'
import { pickDocument } from './blocks/document-picker.js'
import { uploadDocument } from './blocks/document-upload.js'
import { pickImage } from './blocks/image-picker.js'
import { uploadImage } from './blocks/image-upload.js'
import type { AnyRichEditor, RTWikiPartialBlock } from './schema.js'

/**
 * Shared block-insertion definitions for the Rich Document toolbar Insert menu
 * and the slash menu. One source of truth for the entries themselves: both
 * surfaces render the same {@link InsertEntry} objects, so a block inserted from
 * either is identical.
 *
 * The two surfaces are not, however, required to offer the same *set*. An entry
 * declares which surfaces it belongs on, and the Mermaid chooser is toolbar-only:
 * a slash menu is a list of block types, and thirty-odd Mermaid templates are
 * not block types. The content stays defined once either way — the slash menu
 * filters these same entries rather than keeping its own list.
 *
 * Starter content is intentionally minimal and valid; users edit from a
 * working preview rather than a blank schema shape.
 */

type AnyEditor = AnyRichEditor
type AnyPartialBlock = RTWikiPartialBlock

/**
 * Beginner-friendly starter templates offered inside the Diagram edit pane.
 * Each is valid Mermaid so the live preview renders immediately on selection.
 * Single source of truth for the template library: the Diagram page's template
 * bar and the rich-note toolbar's Mermaid chooser both read this list, through
 * `diagramTemplateOptions` in blocks/diagram-template-bar.tsx, and offer
 * identical sets. Insertion no longer uses a fixed starter when a template has
 * been chosen.
 */
export const DIAGRAM_TEMPLATES = {
  // Order follows the toolbar, grouping the everyday diagram types first and
  // the specialist ones after. Keys are Mermaid diagram ids.
  //
  // NOT every type Mermaid 12 registers is listed. Three are withheld, and every
  // claim below was measured in Chromium through this application's own pipeline
  // rather than reasoned about. All three are upstream grammar defects in Mermaid
  // 12.0.0: each fails in Mermaid's PARSER, reports a `parse_error`, and shows the
  // block's "Diagram error" box. None of them can be repaired from here, because
  // the fix would be in Mermaid's grammars — so they are withheld rather than
  // offered broken, which is the rule: a template that cannot render is worse than
  // one that is absent.
  //
  // 1. `swimlane-beta` — its grammar cannot parse a lane. Even the minimal
  //    `swimlane-beta\n  lane A` fails:
  //    `Expecting 'SEMI', 'NEWLINE', 'EOF', 'AMP', 'START_LINK', 'LINK', 'LINK_ID',
  //    got 'NODE_STRING'`.
  //    This was previously recorded here as a LAYOUT problem — that the global
  //    `layout: 'dagre'` in MERMAID_CONFIG overrides swimlanes' own engine. That was
  //    measured and it is wrong: the same source fails identically with the layout
  //    unset and with `layout: 'elk'`. The failure is upstream of layout entirely.
  //
  // 2. `architecture-beta` — renders correctly for services, groups, junctions and
  //    service-to-service edges. It fails only on an edge whose endpoint is a GROUP:
  //    `db:L -- R:api` where `api` is a group throws
  //    `undefined is not an object (evaluating 'this.nodes.get(rhsId).in')`.
  //    So the type is not unsupported — a working subset of it is — which is why
  //    this note previously mis-described it.
  //
  // 3. `cynefin-beta` — parses `title` alone, and fails on any `description` line
  //    with a lexer error on the generated `->d<-` domain markers. Both the bare
  //    form (`A chaos`) and the `domain` keyword form fail identically.
  //
  // A correction to what this comment used to claim: none of these three renders as
  // a silent 24x24 placeholder, and the cause was never the render warm-up failing
  // to resolve a lazy chunk. Every one raises a visible parse error. The chunk-backed
  // types that do work — `wardley-beta`, `usecase-beta`, `agentflow-beta`,
  // `railroad-beta` — prove lazy loading is not the issue.
  //
  // Most of the newer types require their `-beta` keyword, and a bare type name
  // is not a synonym for it: `venn` does not detect, `venn-beta` does. Note that
  // `architecture`, `cynefin` and `swimlane` are inconsistent among themselves —
  // `architecture`'s detector is `/^\s*architecture/` and accepts both forms, while
  // `cynefin`'s is `/^\s*cynefin-beta(?:[\s:]|$)/` and `swimlane`'s is
  // `/^\s*swimlane-beta\b/`, so those two are only ever detected in their `-beta`
  // form. `eventmodeling` and `quadrantChart` are registered bare, with no `-beta`
  // form at all. It is also why `railroad` nests `terminal(...)` inside
  // `choice(...)`: its grammar has no bare-string form.
  //
  // `tests/browser/diagram-templates.pwspec.ts` renders every entry here through
  // the real pipeline and fails on the 24x24 placeholder, so adding one that does
  // not work fails the build rather than the user.
  flowchart: {
    label: 'Flowchart',
    source:
      'flowchart TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Do thing]\n    B -->|No| D[Other thing]'
  },
  sequence: {
    label: 'Sequence',
    source:
      'sequenceDiagram\n    participant U as User\n    participant S as System\n    U->>S: Request\n    S-->>U: Response'
  },
  class: {
    label: 'Class',
    source:
      'classDiagram\n    class Animal {\n      +name: string\n      +speak(): void\n    }\n    class Dog\n    Animal <|-- Dog'
  },
  state: {
    label: 'State',
    source:
      'stateDiagram-v2\n    [*] --> Idle\n    Idle --> Active: start\n    Active --> Idle: stop\n    Active --> [*]'
  },
  er: {
    label: 'Entity relationship',
    source:
      'erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER ||--|{ LINE_ITEM : contains\n    CUSTOMER { string name }'
  },
  timeline: {
    label: 'Timeline',
    source: 'timeline\n    title Project\n    2024 : Plan : Design\n    2025 : Build : Ship'
  },
  mindmap: {
    label: 'Mind map',
    source:
      'mindmap\n    root((Idea))\n      Branch A\n        Leaf A1\n      Branch B\n        Leaf B1'
  },
  gantt: {
    label: 'Gantt',
    source:
      'gantt\n    title Plan\n    dateFormat YYYY-MM-DD\n    section Work\n    Task one :a1, 2024-01-01, 10d\n    Task two :after a1, 12d'
  },
  pie: {
    label: 'Pie',
    source: 'pie title Pets\n    "Dogs" : 386\n    "Cats" : 85\n    "Rats" : 15'
  },
  gitGraph: {
    label: 'Git graph',
    source:
      'gitGraph\n    commit id: "init"\n    branch develop\n    commit id: "feature"\n    checkout main\n    merge develop'
  },
  sankey: {
    label: 'Sankey',
    source:
      'sankey-beta\n    Sources,Energy,20\n    Sources,Water,10\n    Energy,Homes,15\n    Water,Homes,8\n    Homes,Losses,7'
  },
  requirement: {
    label: 'Requirement',
    source:
      'requirementDiagram\n    requirement REQ1 {\n      id: 1\n      text: the system shall respond\n      risk: high\n      verifymethod: test\n    }\n    element Entity1 {\n      type: simulation\n    }\n    REQ1 - satisfies -> Entity1'
  },
  c4: {
    label: 'C4 context',
    source:
      'C4Context\n    title System context\n    Person(customer, "Customer", "A user")\n    System(wiki, "Wiki", "Stores notes")\n    Rel(customer, wiki, "Reads and writes")'
  },
  packet: {
    label: 'Packet',
    source:
      'packet-beta\n    0-15: "Source port"\n    16-31: "Destination port"\n    32-63: "Payload"'
  },
  xychart: {
    label: 'XY chart',
    source:
      'xychart-beta\n    title "Sales"\n    x-axis [jan, feb, mar, apr]\n    y-axis "Revenue (k)" 0 --> 60\n    bar [20, 35, 42, 51]\n    line [18, 30, 38, 46]'
  },
  block: {
    label: 'Block',
    source:
      'block-beta\n    columns 3\n    a["Input"] b["Process"] c["Output"]\n    a --> b\n    b --> c'
  },
  radar: {
    label: 'Radar',
    source:
      'radar-beta\n    title Skills\n    axis A["Speed"], B["Power"], C["Range"]\n    curve Alpha["Alpha"]{85, 60, 70}\n    curve Beta["Beta"]{60, 90, 45}\n    max 100\n    min 0'
  },
  ishikawa: {
    label: 'Fishbone',
    source:
      'ishikawa-beta\n    defect[Defect]\n    people[People]\n    process[Process]\n    tools[Tools]\n    defect --> people\n    defect --> process\n    defect --> tools'
  },
  kanban: {
    label: 'Kanban',
    source:
      'kanban\n    Todo[Todo]\n    Doing[Doing]\n    Done[Done]\n    Todo --> Doing\n    Doing --> Done'
  },
  userJourney: {
    label: 'User journey',
    source:
      'journey\n    title Shopping\n    section Browse\n      Search: 5: Customer\n      Compare: 3: Customer\n    section Buy\n      Checkout: 2: Customer'
  },
  quadrantChart: {
    label: 'Quadrant chart',
    source:
      'quadrantChart\n    title Reach and engagement\n    x-axis Low --> High\n    y-axis Low --> High\n    quadrant-1 We should expand\n    quadrant-2 Need to promote\n    quadrant-3 Re-evaluate\n    quadrant-4 May be improved'
  },
  treemap: {
    label: 'Treemap',
    source: 'treemap\n    "Root"\n        "Alpha": 40\n        "Beta": 35\n        "Gamma": 25'
  },
  treeView: {
    label: 'Tree view',
    // Box-drawing characters, not ASCII: treeView's parser requires them and
    // reindents by INDENT_UNIT, so the pipe and the corner glyphs are load
    // bearing here. They are invisible in a diff, which is why this note
    // exists.
    source: 'treeView-beta\nRoot\n├── Child A\n│   └── Leaf A1\n└── Child B\n    └── Leaf B1'
  },
  venn: {
    label: 'Venn',
    source: 'venn-beta\n    set A[Study]\n    set B[Rest]'
  },
  railroad: {
    label: 'Railroad',
    source: 'railroad-beta\nA = choice(terminal("Yes"), terminal("No"));\nB = terminal("Start");'
  },
  wardley: {
    label: 'Wardley map',
    source:
      'wardley-beta\n    component "Customer" [0.75, 0.2]\n    component "Subdomain" [0.5, 0.4]\n    "Customer" --> "Subdomain"'
  },
  eventmodeling: {
    label: 'Event modeling',
    source: 'eventmodeling\nentity Order\ntf 1 command Order'
  },
  usecase: {
    label: 'Use case',
    source: 'usecase-beta\nCustomer --> PlaceOrder'
  },
  agentflow: {
    label: 'Agent flow',
    source:
      'agentflow-beta\n    Agent1[Planner] --> Agent2[Worker]\n    Agent2 --> Agent3[Reviewer]'
  },
  info: {
    label: 'Info',
    source: 'info'
  }
  // `satisfies`, not a `Record<string, …>` annotation.
  //
  // An annotation widens the keys to `string`, which costs the one thing this
  // list most needs: the compiler can no longer tell you a template exists. With
  // `satisfies` the shape is still checked at every entry, but `keyof typeof
  // DIAGRAM_TEMPLATES` is the union of the real ids — which is what lets
  // `PRESENTATION` in blocks/diagram-template-bar.tsx be declared as a *total*
  // `Record` over those ids. That is what makes a missing icon a compile error
  // instead of a silent shared fallback at runtime, and it is why the nine
  // templates that had no icon could go unnoticed in the first place.
} satisfies Record<string, { label: string; source: string }>

/** A template's id, as a compile-time-checked union rather than `string`. */
export type DiagramTemplateId = keyof typeof DIAGRAM_TEMPLATES

/**
 * Looks a template up by id, for callers that hold a plain `string`.
 *
 * The single place dynamic indexing is allowed. Five call sites hold a `string`
 * (a click handler, a menu row) because they are driven by DOM ids, and each
 * would otherwise need its own cast. The ids they hold all originate from
 * `Object.keys(DIAGRAM_TEMPLATES)`, so a miss is not reachable at runtime — the
 * cast is confined here rather than repeated, and a future caller that invents an
 * id out of thin air still gets one checked place to look at.
 */
export function diagramTemplateFor(id: string): { label: string; source: string } {
  return (DIAGRAM_TEMPLATES as Record<string, { label: string; source: string }>)[id]
}

/** Starter LaTeX formula used by the Formula insertion. */
export const FORMULA_STARTER = 'x^2 + y^2 = z^2'

/** True for a bare empty paragraph, which an insertion replaces in place. */
function isEmptyParagraph(block: { type: string; content?: unknown }): boolean {
  return block.type === 'paragraph' && JSON.stringify(block.content) === JSON.stringify('')
}

/**
 * Inserts a partial block at the cursor: an empty paragraph in place is
 * replaced; otherwise the new block is added after the current one.
 * Shared by every insertion entry point so behaviour never diverges.
 */
function insertOrReplace(editor: AnyEditor, block: AnyPartialBlock): void {
  const current = editor.getTextCursorPosition().block
  if (isEmptyParagraph(current)) {
    editor.updateBlock(current, block as never)
  } else {
    editor.insertBlocks([block], current, 'after')
  }
}

/**
 * Toolbar runs, in display order. Entries in the same run sit together and runs
 * are separated by a divider.
 *
 * The position lives on the entry rather than in a hand-written key list inside
 * the toolbar. A second list is a second thing to forget: an entry added here but
 * not named there simply never appears, which is a silent failure rather than a
 * compile error.
 */
export const INSERT_RUNS = ['blocks', 'basic', 'callout'] as const

/** One run of the toolbar, in the order `INSERT_RUNS` lists them. */
export type InsertRun = (typeof INSERT_RUNS)[number]

/**
 * Which surface offers an Insert entry.
 *
 * The toolbar and the slash menu render the same entry objects, so a surface that
 * should not see an entry says so on the entry itself rather than by each
 * surface keeping its own exclusion list — which is how the two drifted into
 * disagreeing about what RTWiki could insert.
 */
export type InsertSurface = 'toolbar' | 'slash'

export interface InsertEntry {
  /** Stable machine token (also used as the debug-log code field). */
  key: string
  label: string
  /** Tabler icon component for menu rendering. */
  icon:
    | 'formula'
    | 'diagram'
    | 'linkedPage'
    | 'image'
    | 'document'
    | 'table'
    | 'code'
    | 'quote'
    | 'calloutInfo'
    | 'calloutNote'
    | 'calloutTip'
    | 'calloutWarning'
    | 'calloutDanger'
  /** Which toolbar run this entry belongs to. */
  run: InsertRun
  /**
   * Surfaces that offer this entry. Omitted means both.
   *
   * Mermaid sets this to `['toolbar']`: thirty-odd diagram types belong in a
   * deliberate chooser, and a slash menu that filtered them by name would be
   * listing a template library in a menu meant for block types.
   */
  surfaces?: readonly InsertSurface[]
  /**
   * When present, the toolbar button opens a chooser instead of inserting
   * directly, and each option inserts a block with that option's own source.
   */
  submenu?: readonly DiagramTemplateOption[]
  /**
   * Inserts a specific chosen source. Present exactly when {@link submenu} is, so
   * an entry cannot offer a chooser it has no way to act on. `insert` stays the
   * no-choice path — the button's accessible name and its fallback.
   */
  insertSource?: (editor: AnyEditor, source: string) => void
  /**
   * Inserts without a choice. Absent on a chooser entry, which deliberately
   * inserts nothing until a template is picked — a fallback would be an
   * insertion nobody asked for, sitting on a button that only opens a menu.
   */
  insert?: (editor: AnyEditor) => void
}

function formulaEntry(): InsertEntry {
  return {
    key: 'insert-formula',
    label: UI_TEXT.formulaLabel,
    icon: 'formula',
    run: 'blocks',
    insert: (editor) =>
      insertOrReplace(editor, {
        type: 'mathBlock',
        content: FORMULA_STARTER
      } as never)
  }
}

/**
 * The Mermaid entry: a chooser over the shared template list, not one starter.
 *
 * Inserting a fixed `graph TD A-->B` and making the user hunt for the type they
 * wanted afterwards meant the template library was one level deeper than anyone
 * went. The options come from {@link diagramTemplateOptions}, which reads the
 * same DIAGRAM_TEMPLATES the Diagram page's bar reads, so the two surfaces
 * cannot offer different diagrams.
 *
 * A Mermaid mind map is one of those options rather than a separate entry: it is
 * the same block with a different source, and offering it twice was how it ended
 * up with two implementations.
 *
 * There is no no-choice insertion. A default would be a template the user did not
 * pick, behind a button that only opens a menu.
 */
export function diagramEntry(): InsertEntry {
  const insertDiagram = (editor: AnyEditor, content: string): void => {
    insertOrReplace(editor, { type: 'diagram', content } as never)
  }
  return {
    key: 'insert-diagram',
    label: UI_TEXT.diagramLabel,
    icon: 'diagram',
    run: 'blocks',
    surfaces: ['toolbar'],
    submenu: diagramTemplateOptions(),
    insertSource: insertDiagram
  }
}

const CALLOUT_VARIANT_ENTRIES: Array<{
  variant: 'info' | 'note' | 'tip' | 'warning' | 'danger'
  label: string
  icon: InsertEntry['icon']
}> = [
  { variant: 'info', label: UI_TEXT.calloutInfoLabel, icon: 'calloutInfo' },
  { variant: 'note', label: UI_TEXT.calloutNoteLabel, icon: 'calloutNote' },
  { variant: 'tip', label: UI_TEXT.calloutTipLabel, icon: 'calloutTip' },
  { variant: 'warning', label: UI_TEXT.calloutWarningLabel, icon: 'calloutWarning' },
  { variant: 'danger', label: UI_TEXT.calloutDangerLabel, icon: 'calloutDanger' }
]

function linkedPageEntry(): InsertEntry {
  return {
    key: 'insert-linked-page',
    label: UI_TEXT.linkedPageLabel,
    icon: 'linkedPage',
    run: 'blocks',
    insert: (editor) =>
      insertOrReplace(editor, {
        type: 'linkedPage',
        props: { targetId: '' }
      } as never)
  }
}

function calloutEntries(): InsertEntry[] {
  return CALLOUT_VARIANT_ENTRIES.map(({ variant, label, icon }) => ({
    key: `insert-callout-${variant}`,
    label,
    icon,
    run: 'callout' as const,
    insert: (editor) =>
      insertOrReplace(editor, {
        type: 'callout',
        props: { variant },
        content: [{ type: 'text', text: '', styles: {} }]
      } as never)
  }))
}

/**
 * Image insertion from the Insert menu.
 *
 * Unlike every other entry this one cannot finish synchronously: it has to wait
 * for a human to choose a file. The cursor anchor is therefore captured *before*
 * the file dialog opens, because the dialog takes focus and the editor's cursor
 * position is not dependable afterwards. Losing that would put the image at the
 * top of the page instead of where the user was typing.
 */
function imageEntry(): InsertEntry {
  return {
    key: 'insert-image',
    label: UI_TEXT.imageLabel,
    icon: 'image',
    run: 'blocks',
    insert: (editor) => {
      const anchor = editor.getTextCursorPosition().block
      const replaceAnchor = isEmptyParagraph(anchor)

      void pickImage()
        .then((file) => (file ? uploadImage(file) : null))
        .then((url) => {
          if (!url) return
          const block = { type: 'image', props: { url } } as never
          if (replaceAnchor) editor.updateBlock(anchor, block)
          else editor.insertBlocks([block], anchor, 'after')
          editor.focus()
        })
        .catch(() => {
          // The message is already on screen - uploadImage owns it, because
          // paste and drop fail through code this app does not run. All that is
          // left is to hand the caret back, so the user can carry on typing where
          // they left off. A cancelled dialog never reaches here: the picker
          // resolves null instead of rejecting.
          editor.focus()
        })
    }
  }
}

/**
 * Document insertion from the Insert menu.
 *
 * Mirrors `imageEntry` deliberately, down to the shape of the promise chain: the
 * cursor anchor is captured *before* the dialog opens, and the promise is not
 * awaited, because the dialog outlives the call stack and the anchor is not
 * dependable once the OS window has taken focus.
 *
 * ## Why RTWiki's own `documentBlock`, not the built-in `file`
 *
 * Reusing the built-in was the right call when the only requirement was that a
 * document be *attached* and visible. It no longer is. The built-in renders the
 * file's name inside a `div` rather than an anchor, so the attachment is not
 * clickable at all, and it has nowhere to host the three actions a document now
 * offers. A custom block that must be registered in the schema, or it is silently
 * rewritten to a JSON `codeBlock` on every load.
 */
function documentEntry(): InsertEntry {
  return {
    key: 'insert-document',
    label: UI_TEXT.documentLabel,
    icon: 'document',
    run: 'blocks',
    insert: (editor) => {
      const anchor = editor.getTextCursorPosition().block
      const replaceAnchor = isEmptyParagraph(anchor)

      void pickDocument()
        // The name travels alongside the URL so the card shows the file the user
        // chose. It is taken from the picked `File`, not from the server response,
        // so `uploadDocument` keeps the single-value shape it shares with
        // `uploadImage`.
        .then((file) => (file ? uploadDocument(file).then((url) => ({ file, url })) : null))
        .then((picked) => {
          if (!picked) return
          // RTWiki's own `documentBlock`, not BlockNote's built-in `file`: the
          // built-in renders the name in a `div` rather than an anchor, so the
          // attachment would not be clickable, and it has nowhere to put the three
          // actions a document now offers.
          const block = {
            type: 'documentBlock',
            props: { url: picked.url, name: picked.file.name }
          } as never
          if (replaceAnchor) editor.updateBlock(anchor, block)
          else editor.insertBlocks([block], anchor, 'after')
          editor.focus()
        })
        .catch(() => {
          // The message is already on screen - uploadDocument owns it. All that
          // is left is to hand the caret back, so the user can carry on typing
          // where they left off. A cancelled dialog never reaches here: the
          // picker resolves null instead of rejecting.
          editor.focus()
        })
    }
  }
}

/** Entries that exist regardless of optional blocks (always-available). */
function baseEntries(editor: AnyEditor): InsertEntry[] {
  const entries: InsertEntry[] = [formulaEntry()]
  // The Mermaid chooser joins when its block is in the schema.
  if ('diagram' in editor.schema.blockSchema) {
    entries.push(diagramEntry())
  }
  if ('callout' in editor.schema.blockSchema) {
    entries.push(...calloutEntries())
  }
  if ('linkedPage' in editor.schema.blockSchema) {
    entries.push(linkedPageEntry())
  }
  if ('image' in editor.schema.blockSchema) {
    entries.push(imageEntry())
  }
  if ('documentBlock' in editor.schema.blockSchema) {
    entries.push(documentEntry())
  }
  return entries
}

/**
 * All Insert-menu entries for the given editor, including the existing
 * table/code/quote conversions where appropriate.
 */
export function getInsertEntries(editor: AnyEditor): InsertEntry[] {
  return [
    ...baseEntries(editor),
    {
      key: 'insert-table',
      label: UI_TEXT.tableLabel,
      icon: 'table',
      run: 'basic',
      insert: (ed) => {
        const current = ed.getTextCursorPosition().block
        const table = {
          type: 'table',
          content: {
            type: 'tableContent',
            rows: [{ cells: ['', '', ''] }, { cells: ['', '', ''] }]
          }
        } as never
        if (
          current.type === 'paragraph' &&
          JSON.stringify(current.content) === JSON.stringify('')
        ) {
          ed.updateBlock(current, table)
        } else {
          ed.insertBlocks([table], current, 'after')
        }
      }
    },
    {
      key: 'insert-code-block',
      label: UI_TEXT.codeBlockLabel,
      icon: 'code',
      run: 'basic',
      insert: (ed) => {
        const current = ed.getTextCursorPosition().block
        if (
          current.type === 'paragraph' &&
          JSON.stringify(current.content) === JSON.stringify('')
        ) {
          ed.updateBlock(current, { type: 'codeBlock' } as never)
        } else {
          ed.insertBlocks([{ type: 'codeBlock' } as never], current, 'after')
        }
      }
    },
    {
      key: 'insert-quote',
      label: UI_TEXT.quoteLabel,
      icon: 'quote',
      run: 'basic',
      insert: (ed) => {
        const current = ed.getTextCursorPosition().block
        ed.updateBlock(current, { type: 'quote' } as never)
      }
    }
  ]
}

/**
 * Runs an entry's no-choice insertion and returns focus to the editor.
 *
 * A chooser entry has no such insertion, so it is refused here rather than
 * inserted as a default: a guard rather than a cast, because a caller reaching
 * this with a chooser entry has a bug, and inserting a template the user did not
 * pick would hide it.
 */
export function runInsertEntry(editor: AnyEditor, entry: InsertEntry): void {
  if (entry.insert === undefined) {
    throw new Error(`Insert entry "${entry.key}" has no direct insertion; it offers a chooser.`)
  }
  entry.insert(editor)
  editor.focus()
}
