import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UNSUPPORTED_BLOCK_MARKER } from '@rtwiki/shared/constants'
import { app } from '../src/server/app.js'
import { closeDatabase, type getDb, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import * as service from '../src/server/services/page-service.js'
import { parseRichContent, validateRichDocument } from '../src/shared/schemas/rich-content.js'
import { buildTemplateContent } from '../src/web/features/rich-editor/rich-templates.js'

const BASE = 'http://127.0.0.1:8080'

function text(value: string): Record<string, unknown> {
  return { type: 'text', text: value, styles: {} }
}

function paragraph(value: string): Record<string, unknown> {
  return { type: 'paragraph', content: [text(value)] }
}

function doc(...blocks: Record<string, unknown>[]): string {
  return JSON.stringify(blocks)
}

/** A table block in the exact shape BlockNote 0.57.0 writes. */
function tableBlock(): Record<string, unknown> {
  return {
    id: 't1',
    type: 'table',
    props: { textColor: 'default' },
    content: {
      type: 'tableContent',
      columnWidths: [null, null],
      rows: [
        {
          cells: [
            {
              type: 'tableCell',
              props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
              content: [text('Cell one')]
            },
            { type: 'tableCell', props: {}, content: [] }
          ]
        }
      ]
    },
    children: []
  }
}

describe('rich content structural validator', () => {
  it('accepts a basic document with inline text', () => {
    const result = parseRichContent(doc(paragraph('Hello')))
    expect(result).toEqual({ ok: true })
  })

  it('accepts an empty array and a block without content', () => {
    expect(parseRichContent('[]')).toEqual({ ok: true })
    expect(parseRichContent(doc({ type: 'paragraph' }))).toEqual({ ok: true })
  })

  it('accepts nested children recursively', () => {
    const nested = {
      id: 'outer',
      type: 'bulletListItem',
      content: [text('outer')],
      children: [
        {
          id: 'inner',
          type: 'bulletListItem',
          content: [text('inner')],
          children: [paragraph('deep')]
        }
      ]
    }
    expect(parseRichContent(doc(nested))).toEqual({ ok: true })
  })

  it('accepts registered custom blocks and inline math', () => {
    const blocks = [
      {
        id: 'c',
        type: 'callout',
        props: { variant: 'info' },
        content: [text('Check the power supply')],
        children: []
      },
      {
        id: 'd',
        type: 'diagram',
        props: { width: '500', height: '300' },
        content: 'graph TD\n  A-->B',
        children: []
      },
      {
        id: 'm',
        type: 'mathBlock',
        props: {},
        content: [text('E = mc^2')],
        children: []
      },
      {
        id: 'l',
        type: 'linkedPage',
        props: { pageId: '11111111-1111-4111-8111-111111111111' },
        content: [],
        children: []
      },
      {
        id: 'doc',
        type: 'documentBlock',
        props: { url: '/api/attachments/x', name: 'notes.pdf' },
        content: [],
        children: []
      },
      {
        id: 'p',
        type: 'paragraph',
        content: [text('Energy is '), { type: 'math', content: 'x^2', styles: {} }]
      }
    ]
    expect(parseRichContent(doc(...blocks))).toEqual({ ok: true })
  })

  it('accepts table content with cell inline content', () => {
    expect(parseRichContent(doc(tableBlock()))).toEqual({ ok: true })
  })

  it('accepts all four template-generated documents', () => {
    for (const key of ['blank', 'subject', 'chapter', 'revision'] as const) {
      const result = parseRichContent(buildTemplateContent(key))
      expect(result.ok, `template ${key} should be valid`).toBe(true)
    }
  })

  it('accepts an unknown block preserved as a marker code block', () => {
    const preserved = {
      id: 'p1',
      type: 'codeBlock',
      props: { language: 'json' },
      content: `${UNSUPPORTED_BLOCK_MARKER}\n{"type":"hologramBlock","props":{"size":3}}`
    }
    expect(parseRichContent(doc(preserved))).toEqual({ ok: true })
  })

  it('rejects malformed JSON with a useful message', () => {
    const result = parseRichContent('{ not valid json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('valid JSON')
  })

  it('rejects a non-array root', () => {
    const result = parseRichContent('{"type":"paragraph"}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('array of blocks')
  })

  it('rejects a missing type and a non-object block', () => {
    const missing = parseRichContent(doc({ content: [] }))
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain('block type')

    const nonObject = parseRichContent(JSON.stringify(['not a block']))
    expect(nonObject.ok).toBe(false)
    if (!nonObject.ok) expect(nonObject.error).toContain('block object')
  })

  it('rejects invalid children and invalid inline content', () => {
    const badChildren = parseRichContent(doc({ type: 'bulletListItem', children: 'nope' }))
    expect(badChildren.ok).toBe(false)
    if (!badChildren.ok) expect(badChildren.error).toContain('children')

    const badInline = parseRichContent(doc({ type: 'paragraph', content: [42] }))
    expect(badInline.ok).toBe(false)
    if (!badInline.ok) expect(badInline.error).toContain('inline content')
  })

  it('rejects excessive nesting depth', () => {
    let deep: Record<string, unknown> = { type: 'paragraph' }
    for (let index = 0; index < 70; index += 1) {
      deep = { type: 'bulletListItem', children: [deep] }
    }
    const result = parseRichContent(doc(deep))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('nested too deeply')
  })

  it('rejects cyclic structures', () => {
    const block: Record<string, unknown> = { type: 'paragraph' }
    block.children = [block]
    const result = validateRichDocument([block])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('cyclic')
  })
})

describe('rich content validation on write paths', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>

  beforeAll(async () => {
    tempDir = join(tmpdir(), `rtwiki-rich-validation-${Date.now()}-${Math.random()}`)
    mkdirSync(tempDir, { recursive: true })
    db = initDatabase(tempDir)
    await runMigrations(db)
  })

  afterAll(async () => {
    await closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function pageCount(): number {
    return (db.query('SELECT COUNT(*) AS n FROM pages').get() as { n: number }).n
  }

  async function createViaApi(content: string): Promise<Response> {
    return app.fetch(
      new Request(`${BASE}/api/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Rich API ${Date.now()}-${Math.random()}`,
          pageType: 'rich',
          content
        })
      })
    )
  }

  async function patchViaApi(id: string, content: string, version: number): Promise<Response> {
    return app.fetch(
      new Request(`${BASE}/api/pages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, version })
      })
    )
  }

  it('creates a valid basic Rich Note through the service, verbatim', () => {
    const content = doc(paragraph('Service body'))
    const before = pageCount()
    const page = service.createPage(db, { title: 'Service Rich', pageType: 'rich', content })
    expect(page.content).toBe(content)
    expect(pageCount()).toBe(before + 1)
  })

  it('rejects invalid content on create through the service and persists nothing', () => {
    const before = pageCount()
    expect(() =>
      service.createPage(db, { title: 'Bad Service Rich', pageType: 'rich', content: '<raw>' })
    ).toThrow(service.PageValidationError)
    expect(pageCount()).toBe(before)
  })

  it('keeps empty create content verbatim', () => {
    const page = service.createPage(db, { title: 'Empty Rich', pageType: 'rich', content: '' })
    expect(page.content).toBe('')
  })

  it('updates a Rich Note with valid content through the service', () => {
    const page = service.createPage(db, {
      title: 'Update Rich',
      pageType: 'rich',
      content: doc(paragraph('v1'))
    })
    const next = doc(paragraph('v2'))
    const updated = service.updatePage(db, page.id, { content: next, version: page.version })
    expect(updated?.content).toBe(next)
  })

  it('rejects invalid content on update through the service and leaves the row unchanged', () => {
    const original = doc(paragraph('untouched'))
    const page = service.createPage(db, {
      title: 'Bad Update Rich',
      pageType: 'rich',
      content: original
    })
    expect(() =>
      service.updatePage(db, page.id, { content: '{ broken', version: page.version })
    ).toThrow(service.PageValidationError)
    expect(service.getPage(db, page.id)?.content).toBe(original)
  })

  it('rejects an empty update for a Rich Note', () => {
    const page = service.createPage(db, {
      title: 'Empty Update Rich',
      pageType: 'rich',
      content: doc(paragraph('keep me'))
    })
    expect(() => service.updatePage(db, page.id, { content: '', version: page.version })).toThrow(
      service.PageValidationError
    )
  })

  it('creates a valid Rich Note through the API with 201', async () => {
    const content = doc(paragraph('API body'))
    const res = await createViaApi(content)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { page: { content: string; id: string } }
    expect(body.page.content).toBe(content)
  })

  it('rejects invalid Rich Note content through the API with 400 and persists nothing', async () => {
    const before = pageCount()
    const res = await createViaApi('{ not valid json')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('valid JSON')
    expect(pageCount()).toBe(before)
  })

  it('rejects a non-array root through the API with 400', async () => {
    const res = await createViaApi('{"type":"paragraph"}')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('array of blocks')
  })

  it('accepts a valid Rich Note update through the API', async () => {
    const created = await createViaApi(doc(paragraph('v1')))
    const { page } = (await created.json()) as { page: { id: string; version: number } }
    const next = doc(paragraph('v2'))
    const res = await patchViaApi(page.id, next, page.version)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { page: { content: string } }
    expect(body.page.content).toBe(next)
  })

  it('rejects an invalid Rich Note update through the API with 400 and persists nothing', async () => {
    const original = doc(paragraph('still here'))
    const created = await createViaApi(original)
    const { page } = (await created.json()) as { page: { id: string; version: number } }
    const res = await patchViaApi(page.id, '[] but not json', page.version)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('valid JSON')
    const fetched = await app.fetch(new Request(`${BASE}/api/pages/${page.id}`))
    const after = (await fetched.json()) as { page: { content: string } }
    expect(after.page.content).toBe(original)
  })

  it('accepts a real document shape from the compatibility scan', () => {
    // Representative of the 1,618 non-empty documents scanned in both DBs:
    // a heading, a table with cell content, and a paragraph with props/children.
    const fixture = JSON.stringify([
      {
        id: '9382e5b1-6b28-4026-8bd9-4c21d95f2f74',
        type: 'heading',
        props: {
          backgroundColor: 'default',
          textColor: 'default',
          textAlignment: 'left',
          level: 1,
          isToggleable: false
        },
        content: [{ type: 'text', text: 'fsds', styles: {} }],
        children: []
      },
      tableBlock(),
      {
        id: 'aa7765e7-bc9e-4ad5-8544-edffa30ae381',
        type: 'paragraph',
        props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
        content: [],
        children: []
      }
    ])
    expect(parseRichContent(fixture)).toEqual({ ok: true })
    const page = service.createPage(db, {
      title: 'Scanned Fixture',
      pageType: 'rich',
      content: fixture
    })
    expect(page.content).toBe(fixture)
  })
})
