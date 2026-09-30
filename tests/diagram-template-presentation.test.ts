import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DIAGRAM_TEMPLATE_FAMILIES,
  diagramTemplateOptions,
  diagramTemplatePresentationIds
} from '../src/web/features/rich-editor/blocks/diagram-template-bar.js'
import { DIAGRAM_TEMPLATES } from '../src/web/features/rich-editor/insert-blocks.js'

/**
 * Every Mermaid template has exactly one icon of its own.
 *
 * ## The defect this exists for
 *
 * Nine templates — `quadrantChart`, `treemap`, `treeView`, `venn`, `railroad`,
 * `wardley`, `eventmodeling`, `usecase`, `agentflow` — had no entry in the bar's
 * `PRESENTATION` map, so all nine rendered the *same* fallback glyph. A third of
 * the template bar was visually identical, and the bar offers no labels at button
 * size, so a user could not tell them apart.
 *
 * It was invisible because the fallback was designed to be invisible: it rendered
 * happily, raised nothing, and failed no test. That is the lesson this file
 * encodes — the shared fallback was the bug, not the missing icons.
 *
 * ## No hardcoded count
 *
 * The comparisons below are between the two live key sets. The count is never
 * written down, so adding a template is not a test to update and cannot make this
 * file quietly stop checking anything.
 */
const templateIds = Object.keys(DIAGRAM_TEMPLATES).sort()
const presentationIds = diagramTemplatePresentationIds().sort()

describe('Mermaid template presentation coverage', () => {
  it('covers every template, and only templates — the two key sets are equal', () => {
    // Both directions in one assertion, because one direction alone is the trap:
    // "every template has an icon" passes even when a deleted template's icon
    // lingers, and "every icon belongs to a template" passes even when a template
    // has none.
    expect(presentationIds).toEqual(templateIds)
  })

  it('names no presentation for a template that does not exist', () => {
    const ghosts = presentationIds.filter((id) => !(id in DIAGRAM_TEMPLATES))
    expect(ghosts, 'a presentation entry with no template behind it').toEqual([])
  })

  it('leaves no template without a presentation', () => {
    const orphans = templateIds.filter((id) => !presentationIds.includes(id))
    expect(orphans, 'a template with no icon, which used to fall back silently').toEqual([])
  })

  it('renders every template icon to real SVG markup', () => {
    // The question that matters is not "is this value defined" but "does this
    // button show a picture". So each icon is actually rendered.
    //
    // Two earlier versions of this assertion were wrong and are worth recording:
    // `typeof === 'function'` fails, because Tabler builds icons with
    // `createReactComponent` and a `forwardRef` component is an *object*; and
    // `isValidElementType` is not exported from this build's `react` entry point.
    // Rendering sidesteps both and tests the real behaviour instead.
    const options = diagramTemplateOptions()
    expect(options.length).toBe(templateIds.length)
    for (const option of options) {
      const markup = renderToStaticMarkup(createElement(option.Icon, { size: 24 }))
      expect(markup, `${option.id} rendered nothing`).toContain('<svg')
      expect(markup.length, `${option.id} rendered an empty svg`).toBeGreaterThan(40)
    }
  })

  it('uses a different icon for every template, so none is indistinguishable', () => {
    // The assertion that would actually have caught the original defect. Key-set
    // parity does not catch it: a deliberate shared icon satisfies parity while
    // still making two buttons impossible to tell apart, which is exactly the
    // complaint that started this.
    const byIcon = new Map<unknown, string[]>()
    for (const option of diagramTemplateOptions()) {
      byIcon.set(option.Icon, [...(byIcon.get(option.Icon) ?? []), option.id])
    }
    const shared = [...byIcon.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([icon, ids]) => `${ids.join(' = ')}`)
    expect(shared, 'templates sharing one icon').toEqual([])
  })

  it('assigns every template a known family, so the row order and colour are defined', () => {
    for (const option of diagramTemplateOptions()) {
      expect(
        DIAGRAM_TEMPLATE_FAMILIES,
        `${option.id} has family "${option.family}", which is not one of the declared families`
      ).toContain(option.family)
    }
  })

  it('gives every template a non-empty label and a source Mermaid can parse', () => {
    for (const [id, def] of Object.entries(DIAGRAM_TEMPLATES)) {
      expect(def.label.trim(), `${id} has no label`).not.toBe('')
      expect(def.source.trim(), `${id} has no source`).not.toBe('')
    }
  })

  it('keeps each template id unique in the options the bar offers', () => {
    const ids = diagramTemplateOptions().map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
