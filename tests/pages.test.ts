import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, type getDb, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import * as repo from '../src/server/repositories/page-repository.js'
import * as service from '../src/server/services/page-service.js'

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `rtwiki-page-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

describe('page CRUD', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>

  beforeAll(async () => {
    tempDir = makeTempDir()
    db = initDatabase(tempDir)
    await runMigrations(db)
  })

  afterAll(async () => {
    await closeDatabase()
    cleanup(tempDir)
  })

  it('creates a page with default type rich', () => {
    const page = service.createPage(db, { title: 'Test Page', pageType: 'rich', content: '' })
    expect(page.id).toBeDefined()
    expect(page.id.length).toBe(36)
    expect(page.title).toBe('Test Page')
    expect(page.pageType).toBe('rich')
    expect(page.content).toBe('')
    expect(page.version).toBe(1)
    expect(page.deletedAt).toBeNull()
  })

  it('creates a page with type html', () => {
    const canonical = '{"version":1,"html":"<div>hi</div>","css":"","javascript":""}'
    const page = service.createPage(db, {
      title: 'HTML Page',
      pageType: 'html',
      content: canonical
    })
    expect(page.pageType).toBe('html')
    expect(page.content).toBe(canonical)
  })

  it('gets a page by id', () => {
    const created = service.createPage(db, { title: 'Get Test', pageType: 'rich', content: 'body' })
    const fetched = service.getPage(db, created.id)
    expect(fetched).not.toBeNull()
    expect(fetched?.id).toBe(created.id)
    expect(fetched?.title).toBe('Get Test')
    expect(fetched?.content).toBe('body')
  })

  it('returns null for non-existent page', () => {
    const result = service.getPage(db, '00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })

  it('updates page title', () => {
    const page = service.createPage(db, { title: 'Original', pageType: 'rich', content: '' })
    const updated = service.updatePage(db, page.id, { title: 'Updated' })
    expect(updated).not.toBeNull()
    expect(updated?.title).toBe('Updated')
    expect(updated?.version).toBe(page.version + 1)
  })

  it('updates page content', () => {
    const page = service.createPage(db, { title: 'Content Test', pageType: 'rich', content: 'v1' })
    const updated = service.updatePage(db, page.id, { content: 'v2' })
    expect(updated?.content).toBe('v2')
  })

  it('drops pageType from update input (no conversion in Phase 4A)', async () => {
    const { UpdatePageSchema } = await import('@rtwiki/shared/schemas/pages')
    const parsed = UpdatePageSchema.safeParse({ title: 'New Title', pageType: 'html' })
    // The schema strips the field silently; the route layer rejects its
    // presence explicitly (see pages-controller API tests).
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect('pageType' in parsed.data).toBe(false)
    }
  })

  it('returns null when updating non-existent page', () => {
    const result = service.updatePage(db, '00000000-0000-0000-0000-000000000000', { title: 'x' })
    expect(result).toBeNull()
  })

  it('lists pages sorted by updated_at desc', async () => {
    const p1 = service.createPage(db, { title: 'First', pageType: 'rich', content: '' })
    await new Promise((r) => setTimeout(r, 10))
    const p2 = service.createPage(db, { title: 'Second', pageType: 'rich', content: '' })

    const result = service.listPages(db)
    expect(result.pages.length).toBeGreaterThanOrEqual(2)
    expect(result.pages[0].id).toBe(p2.id)
    expect(result.pages[1].id).toBe(p1.id)
  })

  it('searches pages by title', () => {
    service.createPage(db, { title: 'Quantum Physics Notes', pageType: 'rich', content: 'quarks' })
    service.createPage(db, { title: 'History Timeline', pageType: 'rich', content: 'dates' })

    const result = service.listPages(db, { search: 'Physics' })
    expect(result.pages.some((p) => p.title === 'Quantum Physics Notes')).toBe(true)
    expect(result.pages.some((p) => p.title === 'History Timeline')).toBe(false)
  })

  it('searches pages by content', () => {
    service.createPage(db, {
      title: 'Notes',
      pageType: 'rich',
      content: 'The mitochondria is the powerhouse'
    })
    const result = service.listPages(db, { search: 'mitochondria' })
    expect(result.pages.some((p) => p.title === 'Notes')).toBe(true)
  })

  it('duplicates a page with new id and copy suffix', () => {
    const original = service.createPage(db, {
      title: 'Original Page',
      pageType: 'rich',
      content: 'content here'
    })
    const copy = service.duplicatePage(db, original.id)
    expect(copy).not.toBeNull()
    expect(copy?.id).not.toBe(original.id)
    expect(copy?.title).toBe('Original Page - Copy')
    expect(copy?.content).toBe('content here')
    expect(copy?.pageType).toBe('rich')
  })

  it('returns null when duplicating non-existent page', () => {
    const result = service.duplicatePage(db, '00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })

  it('soft-deletes a page', () => {
    const page = service.createPage(db, { title: 'Delete Me', pageType: 'rich', content: '' })
    const deleted = service.softDeletePage(db, page.id)
    expect(deleted).toBe(true)
    const fetched = service.getPage(db, page.id)
    expect(fetched).toBeNull()
  })

  it('returns false when soft-deleting non-existent page', () => {
    const result = service.softDeletePage(db, '00000000-0000-0000-0000-000000000000')
    expect(result).toBe(false)
  })

  it('does not list soft-deleted pages', () => {
    const page = service.createPage(db, { title: 'Gone Soon', pageType: 'rich', content: '' })
    service.softDeletePage(db, page.id)
    const result = service.listPages(db)
    expect(result.pages.some((p) => p.id === page.id)).toBe(false)
  })
})

describe('rich-content JSON round trip', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>

  beforeAll(async () => {
    tempDir = makeTempDir()
    db = initDatabase(tempDir)
    await runMigrations(db)
  })

  afterAll(async () => {
    await closeDatabase()
    cleanup(tempDir)
  })

  it('stores and retrieves BlockNote JSON content', () => {
    const blockNoteJson = JSON.stringify({
      type: 'blockContainer',
      children: [
        {
          type: 'heading',
          props: { level: 1 },
          content: [{ type: 'text', text: 'Hello', styles: {} }]
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'World', styles: { bold: true } }]
        }
      ]
    })
    const page = service.createPage(db, {
      title: 'JSON Test',
      pageType: 'rich',
      content: blockNoteJson
    })
    const fetched = service.getPage(db, page.id)
    expect(fetched?.content).toBe(blockNoteJson)
    const parsed = JSON.parse(fetched?.content as string)
    expect(parsed.children[0].type).toBe('heading')
    expect(parsed.children[0].content[0].text).toBe('Hello')
  })

  it('preserves content through update cycle', () => {
    const original = JSON.stringify({
      type: 'blockContainer',
      children: [{ type: 'paragraph', content: [{ type: 'text', text: 'v1', styles: {} }] }]
    })
    const page = service.createPage(db, {
      title: 'Update Test',
      pageType: 'rich',
      content: original
    })
    const updatedContent = JSON.stringify({
      type: 'blockContainer',
      children: [{ type: 'paragraph', content: [{ type: 'text', text: 'v2', styles: {} }] }]
    })
    service.updatePage(db, page.id, { content: updatedContent })
    const fetched = service.getPage(db, page.id)
    expect(fetched?.content).toBe(updatedContent)
  })
})

describe('HTML-page canonical content lifecycle', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>

  beforeAll(async () => {
    tempDir = makeTempDir()
    db = initDatabase(tempDir)
    await runMigrations(db)
  })

  afterAll(async () => {
    await closeDatabase()
    cleanup(tempDir)
  })

  it('lenient create: omitted content becomes the canonical empty document', () => {
    const page = service.createPage(db, { title: 'Empty HTML', pageType: 'html', content: '' })
    expect(page.pageType).toBe('html')
    expect(page.content).toBe('{"version":2,"html":"","css":"","javascript":"","jsEnabled":false}')
  })

  it('stores and retrieves populated canonical content verbatim', () => {
    // Key order and formatting are preserved exactly as submitted.
    const canonical = '{"version":1,"html":"<h1>Title</h1>","css":"h1{color:red}","javascript":""}'
    const page = service.createPage(db, {
      title: 'HTML Test',
      pageType: 'html',
      content: canonical
    })
    const fetched = service.getPage(db, page.id)
    expect(fetched?.pageType).toBe('html')
    expect(fetched?.content).toBe(canonical)
  })

  it('rejects malformed non-empty content on create', () => {
    expect(() =>
      service.createPage(db, {
        title: 'Bad HTML',
        pageType: 'html',
        content: '<div>not json</div>'
      })
    ).toThrow(service.PageValidationError)
  })

  it('rejects non-canonical JSON shapes on create (wrong version, unknown keys)', () => {
    expect(() =>
      service.createPage(db, {
        title: 'Wrong Version',
        pageType: 'html',
        content: '{"version":2,"html":"","css":"","javascript":""}'
      })
    ).toThrow(service.PageValidationError)
    expect(() =>
      service.createPage(db, {
        title: 'Unknown Keys',
        pageType: 'html',
        content:
          '{"version":1,"html":"","css":"","javascript":"","jsEnabled":false,"schemaVersion":1}'
      })
    ).toThrow(service.PageValidationError)
  })

  it('validates strictly on update and stores valid content verbatim', () => {
    const page = service.createPage(db, { title: 'Update HTML', pageType: 'html', content: '' })
    expect(() =>
      service.updatePage(db, page.id, {
        content: '{"version":9,"html":"","css":"","javascript":""}'
      })
    ).toThrow(service.PageValidationError)

    const next = '{"version":1,"html":"<p>v2</p>","css":"","javascript":"console.log(2)"}'
    const updated = service.updatePage(db, page.id, { content: next })
    expect(updated?.content).toBe(next)
  })

  it('leaves rich-page content validation unchanged (any string accepted)', () => {
    const page = service.createPage(db, { title: 'Rich Any', pageType: 'rich', content: '<raw>' })
    expect(page.content).toBe('<raw>')
    const updated = service.updatePage(db, page.id, { content: 'still anything' })
    expect(updated?.content).toBe('still anything')
  })

  it('preserves stored legacy/malformed content verbatim (validate-on-write only)', () => {
    // Simulate legacy rows written before canonical validation existed by
    // inserting through the repository directly. Legacy garbage indexes as
    // empty search text, matching extractSearchableContent's contract.
    const legacy = service.createPage(db, { title: 'Legacy', pageType: 'rich', content: '' })
    repo.createPage(
      db,
      crypto.randomUUID(),
      'Legacy HTML',
      'html',
      '<p>pre-canonical garbage</p>',
      ''
    )

    // Read returns the stored bytes untouched.
    const listed = service.listPages(db, { search: 'Legacy HTML' })
    const legacyPage = listed.pages.find((p) => p.title === 'Legacy HTML')
    if (!legacyPage) {
      throw new Error('legacy page should be listed')
    }
    expect(legacyPage.content).toBe('<p>pre-canonical garbage</p>')

    // Title-only updates succeed without rewriting content.
    const renamed = service.updatePage(db, legacyPage.id, { title: 'Legacy Renamed' })
    expect(renamed?.content).toBe('<p>pre-canonical garbage</p>')

    // Duplicates copy the malformed content verbatim.
    const copy = service.duplicatePage(db, legacyPage.id)
    expect(copy?.content).toBe('<p>pre-canonical garbage</p>')

    void legacy
  })

  it('duplicates and deletes html pages unchanged', () => {
    const canonical = '{"version":1,"html":"<b>x</b>","css":"","javascript":""}'
    const page = service.createPage(db, {
      title: 'Dup Delete',
      pageType: 'html',
      content: canonical
    })
    const copy = service.duplicatePage(db, page.id)
    expect(copy?.content).toBe(canonical)
    expect(copy?.pageType).toBe('html')
    expect(service.softDeletePage(db, page.id)).toBe(true)
    expect(service.getPage(db, page.id)).toBeNull()
  })
})

describe('HTML-page search indexing', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>

  beforeAll(async () => {
    tempDir = makeTempDir()
    db = initDatabase(tempDir)
    await runMigrations(db)
  })

  afterAll(async () => {
    await closeDatabase()
    cleanup(tempDir)
  })

  it('indexes readable HTML text, not markup, CSS or JavaScript', () => {
    const canonical = JSON.stringify({
      version: 1,
      html: '<h1>Photosynthesis Overview</h1><p>Chloroplasts convert light energy.</p>',
      css: '.cssOnlyMarker { color: red; }',
      javascript: 'var jsOnlyMarker = 1;'
    })
    const page = service.createPage(db, {
      title: 'Biology Notes',
      pageType: 'html',
      content: canonical
    })

    const found = service.listPages(db, { search: 'Chloroplasts' })
    expect(found.pages.some((p) => p.id === page.id)).toBe(true)

    // Markup/CSS/JS source must not match.
    expect(service.listPages(db, { search: 'cssOnlyMarker' }).pages).toHaveLength(0)
    expect(service.listPages(db, { search: 'jsOnlyMarker' }).pages).toHaveLength(0)
    expect(service.listPages(db, { search: '<h1>' }).pages).toHaveLength(0)
  })

  it('refreshes the index when html content is updated', () => {
    const v1 = JSON.stringify({
      version: 1,
      html: '<p>OriginalSearchTerm lives here</p>',
      css: '',
      javascript: ''
    })
    const page = service.createPage(db, { title: 'Refresh Test', pageType: 'html', content: v1 })
    expect(service.listPages(db, { search: 'OriginalSearchTerm' }).pages).toHaveLength(1)

    const v2 = JSON.stringify({
      version: 1,
      html: '<p>ReplacementSearchTerm lives here</p>',
      css: '',
      javascript: ''
    })
    service.updatePage(db, page.id, { content: v2 })

    expect(service.listPages(db, { search: 'OriginalSearchTerm' }).pages).toHaveLength(0)
    expect(service.listPages(db, { search: 'ReplacementSearchTerm' }).pages).toHaveLength(1)
  })

  it('removes the search entry on deletion', () => {
    const canonical = JSON.stringify({
      version: 1,
      html: '<p>DeleteableSearchTerm</p>',
      css: '',
      javascript: ''
    })
    const page = service.createPage(db, {
      title: 'Delete Search',
      pageType: 'html',
      content: canonical
    })
    expect(service.listPages(db, { search: 'DeleteableSearchTerm' }).pages).toHaveLength(1)

    service.softDeletePage(db, page.id)
    expect(service.listPages(db, { search: 'DeleteableSearchTerm' }).pages).toHaveLength(0)
  })

  it('keeps rich-page search behavior unchanged (raw JSON indexed)', () => {
    const richJson = '[{"type":"paragraph","content":[{"type":"text","text":"RichRawIndexTerm"}]}]'
    const page = service.createPage(db, {
      title: 'Rich Search',
      pageType: 'rich',
      content: richJson
    })
    // Rich content continues to be indexed verbatim — searching a term that
    // only exists inside the stored JSON still finds the page, exactly as
    // before this phase.
    expect(
      service.listPages(db, { search: 'RichRawIndexTerm' }).pages.some((p) => p.id === page.id)
    ).toBe(true)
  })

  it('duplicates refresh the index for html copies', () => {
    const canonical = JSON.stringify({
      version: 1,
      html: '<p>DuplicateIndexTerm</p>',
      css: '',
      javascript: ''
    })
    const page = service.createPage(db, {
      title: 'Dup Search',
      pageType: 'html',
      content: canonical
    })
    const copy = service.duplicatePage(db, page.id)
    expect(copy).not.toBeNull()
    expect(service.listPages(db, { search: 'DuplicateIndexTerm' }).pages).toHaveLength(2)
  })
})

describe('API validation', () => {
  it('CreatePageSchema rejects empty title', async () => {
    const { CreatePageSchema } = await import('@rtwiki/shared/schemas/pages')
    const result = CreatePageSchema.safeParse({ title: '' })
    expect(result.success).toBe(false)
  })

  it('CreatePageSchema rejects title over 200 chars', async () => {
    const { CreatePageSchema } = await import('@rtwiki/shared/schemas/pages')
    const result = CreatePageSchema.safeParse({ title: 'x'.repeat(201) })
    expect(result.success).toBe(false)
  })

  it('CreatePageSchema accepts valid input', async () => {
    const { CreatePageSchema } = await import('@rtwiki/shared/schemas/pages')
    const result = CreatePageSchema.safeParse({ title: 'Valid Title' })
    expect(result.success).toBe(true)
  })

  it('UpdatePageSchema accepts partial updates', async () => {
    const { UpdatePageSchema } = await import('@rtwiki/shared/schemas/pages')
    const result = UpdatePageSchema.safeParse({ title: 'New Title' })
    expect(result.success).toBe(true)
  })

  it('UpdatePageSchema rejects empty title', async () => {
    const { UpdatePageSchema } = await import('@rtwiki/shared/schemas/pages')
    const result = UpdatePageSchema.safeParse({ title: '' })
    expect(result.success).toBe(false)
  })
})
