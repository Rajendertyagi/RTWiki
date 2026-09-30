import { describe, expect, it } from 'bun:test'
import { diagramTemplateOptions } from '../src/web/features/rich-editor/blocks/diagram-template-bar.js'
import {
  DIAGRAM_TEMPLATES,
  diagramEntry,
  diagramTemplateFor
} from '../src/web/features/rich-editor/insert-blocks.js'

/**
 * Guards on the two properties that make the Mermaid insertion surfaces honest.
 *
 * Both are cheap to state and expensive to rediscover: the first is the only
 * thing stopping a second Mermaid template list from appearing, and the second is
 * the only thing keeping thirty-odd diagram types out of a slash menu that lists
 * block types.
 */
describe('the Mermaid insertion entry', () => {
  const entry = diagramEntry()

  it('offers the shared template list, not a copy of it', () => {
    // Contents, both directions: the chooser must not omit a template, and must
    // not offer one the Diagram bar does not. The stronger property — that the
    // chooser is *built from* the list rather than restated — is structural:
    // `diagramEntry` makes exactly one call to `diagramTemplateOptions`, which is
    // the only thing in the application that reads DIAGRAM_TEMPLATES for a menu.
    const options = diagramTemplateOptions()
    const canonical = Object.keys(DIAGRAM_TEMPLATES).sort()
    expect(options.length).toBe(canonical.length)
    // Compared as sets, not in order: the chooser is grouped by family on purpose,
    // and the grouping is asserted separately below.
    expect([...(entry.submenu ?? [])].map((o) => o.id).sort()).toEqual(canonical)
  })

  it('carries the canonical source and label for every option', () => {
    for (const option of entry.submenu ?? []) {
      const canonical = diagramTemplateFor(option.id)
      expect(canonical, `${option.id} must exist in the shared list`).toBeDefined()
      expect(option.source).toBe(canonical.source)
      expect(option.label).toBe(canonical.label)
      expect(option.source.length, `${option.id} must have a source`).toBeGreaterThan(0)
      expect(option.label.trim().length, `${option.id} must have a label`).toBeGreaterThan(0)
    }
  })

  it('can insert a chosen source, not only its fallback', () => {
    // Without this the toolbar would render a chooser whose rows did nothing, and
    // nothing in the type system would notice.
    expect(typeof entry.insertSource).toBe('function')
  })

  it('is toolbar-only, so the slash menu keeps listing block types', () => {
    expect(entry.surfaces).toEqual(['toolbar'])
  })

  it('offers the mindmap as a template rather than as a second block type', () => {
    const ids = (entry.submenu ?? []).map((o) => o.id)
    expect(ids).toContain('mindmap')
    // The retired block type must not reappear as an insertion of its own, and
    // the Mermaid entry must not have become a second key for it.
    expect(entry.key).toBe('insert-diagram')
    expect(ids).not.toContain('mindMap')
  })

  it('orders options by family, contiguously', () => {
    // The chooser draws a divider wherever the family changes, so a family that
    // reappeared after another would end up in two separately-headed groups.
    const families = (entry.submenu ?? []).map((o) => o.family)
    const runs: string[] = []
    for (const family of families) {
      if (runs[runs.length - 1] !== family) runs.push(family)
    }
    expect(
      new Set(families).size,
      `families appeared in ${runs.length} runs: ${runs.join(' > ')}`
    ).toBe(runs.length)
  })
})
