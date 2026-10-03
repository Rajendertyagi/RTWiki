/*
 * The three diagram types RTWiki deliberately does not offer, and why.
 *
 * ## Why this test exists
 *
 * `DIAGRAM_TEMPLATES` omits `swimlane-beta`, `architecture-beta` and `cynefin-beta`.
 * That omission was originally justified by a comment which turned out to be wrong on
 * every specific claim, and a wrong comment is worse than none: it stops the next agent
 * from looking. This test pins the *measured* reasons so the omission cannot be
 * "fixed" by someone acting on the old explanation.
 *
 * ## What was measured, in Chromium, through this application's own pipeline
 *
 * - `swimlane-beta` cannot parse a lane at all. Even `swimlane-beta\n  lane A` fails
 *   with `Expecting 'SEMI', 'NEWLINE', 'EOF', 'AMP', 'START_LINK', 'LINK', 'LINK_ID',
 *   got 'NODE_STRING'`. It fails identically with `layout: 'dagre'`, with the layout
 *   unset, and with `layout: 'elk'` — so it is not caused by the global layout pin,
 *   which is what the old comment claimed.
 * - `architecture-beta` is NOT wholly broken. Services, groups, junctions and
 *   service-to-service edges all render. Only an edge whose endpoint is a **group**
 *   fails, with `undefined is not an object (evaluating 'this.nodes.get(rhsId).in')`.
 * - `cynefin-beta` parses `title` alone and fails on any `description` line, with a
 *   lexer error on the generated `->d<-` domain markers — in both the bare form and
 *   the `domain` keyword form.
 *
 * All three are defects in Mermaid 12.0.0's own grammars. Each raises a visible parse
 * error rather than rendering a silent empty box, and none can be repaired from here
 * without forking Mermaid.
 *
 * The end-to-end counterpart is `tests/browser/mermaid-fixture-audit.pwspec.ts`, which
 * proves the same conclusions by running them. This file is the cheap, source-level
 * guard that keeps the documentation and the template list honest.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { DIAGRAM_TEMPLATES } from '../src/web/features/rich-editor/insert-blocks.js'

const SOURCE = readFileSync(
  new URL('../src/web/features/rich-editor/insert-blocks.ts', import.meta.url),
  'utf8'
)

/** The template keys, which are Mermaid diagram ids. */
const offered = Object.keys(DIAGRAM_TEMPLATES)

describe('withheld Mermaid diagram types', () => {
  it('does not offer the three types Mermaid 12.0.0 cannot render', () => {
    // `swimlane-beta` — unparseable grammar.
    expect(offered, 'swimlane cannot render at all').not.toContain('swimlane')
    // `architecture-beta` — renders, but not the group-edge form a template needs.
    expect(offered, 'architecture is only partly supported').not.toContain('architecture')
    // `cynefin-beta` — any useful diagram needs a description, which fails to parse.
    expect(offered, 'cynefin needs a description, which fails').not.toContain('cynefin')
  })

  it('records the measured cause, not the superseded explanation', () => {
    // The old comment blamed the global `layout: 'dagre'` for swimlane. That was
    // measured and disproved — swimlane fails with the layout unset and with `elk`
    // too — so the explanation must not come back.
    expect(SOURCE).toContain("got 'NODE_STRING'")
    expect(SOURCE).toMatch(/measured and it is wrong/)
    expect(SOURCE).not.toMatch(/a layout problem, not a rendering one/)
  })

  it('records that architecture and cynefin render in part', () => {
    // Both were described as wholly broken. They are not, and the distinction matters:
    // a future Mermaid upgrade that fixes the group edge would make architecture
    // offerable, which is only discoverable if the partial support is written down.
    expect(SOURCE).toMatch(/renders correctly for services, groups, junctions/)
    expect(SOURCE).toMatch(/parses `title` alone/)
  })

  it('corrects the claim that these fail silently', () => {
    // "Renders as Mermaid's empty 24x24 placeholder: no error is raised" was wrong.
    // Every one of them raises a visible parse error, which is why the fixture audit
    // detects them by the error box rather than by geometry.
    expect(SOURCE).toMatch(/none of these three renders as\s*\n?\s*.*silent 24x24 placeholder/)
    expect(SOURCE).not.toMatch(/both render as Mermaid's empty 24x24/)
  })

  it('still offers the types that do work, including the chunk-backed ones', () => {
    // Guards the opposite error: withholding everything new because three of them are
    // broken. The chunk-backed types prove lazy loading is not the cause.
    for (const id of ['venn', 'railroad', 'sankey', 'xychart', 'radar', 'ishikawa']) {
      expect(offered, `${id} renders and must remain offerable`).toContain(id)
    }
  })
})
