import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  rmSync,
  mkdirSync,
} from 'node:fs'
import {
  initDatabase,
  closeDatabase,
  type getDb,
} from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import * as service from '../src/server/services/page-service.js'

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `rtwiki-page-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
    const page = service.createPage(db, {
      title: 'Test Page',
      pageType: 'rich',
      content: '',
    })
    expect(page.id).toBeDefined()
    expect(page.id.length).toBe(36)
    expect(page.title).toBe('Test Page')
    expect(page.pageType).toBe('rich')
    expect(page.content).toBe('')
    expect(page.version).toBe(1)
    expect(page.deletedAt).toBeNull()
  })

  it('creates a page with type html', () => {
    const page = service.createPage(db, {
      title: 'HTML Page',
      pageType: 'html',
      content: '<div>hi</div>',
    })
    expect(page.pageType).toBe('html')
    expect(page.content).toBe('<div>hi</div>')
  })

  it('gets a page by id', () => {
    const created = service.createPage(db, {
      title: 'Get Test',
      pageType: 'rich',
      content: 'body',
    })
    const fetched = service.getPage(db, created.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(created.id)
    expect(fetched!.title).toBe('Get Test')
    expect(fetched!.content).toBe('body')
  })

  it('returns null for non-existent page', () => {
    const result = service.getPage(
      db,
      '00000000-0000-0000-0000-000000000000',
    )
    expect(result).toBeNull()
  })

  it('updates page title', () => {
    const page = service.createPage(db, {
      title: 'Original',
      pageType: 'rich',
      content: '',
    })
    const updated = service.updatePage(db, page.id, {
      title: 'Updated',
    })
    expect(updated).not.toBeNull()
    expect(updated!.title).toBe('Updated')
    expect(updated!.version).toBe(page.version + 1)
  })

  it('updates page content', () => {
    const page = service.createPage(db, {
      title: 'Content Test',
      pageType: 'rich',
      content: 'v1',
    })
    const updated = service.updatePage(db, page.id, {
      content: 'v2',
    })
    expect(updated!.content).toBe('v2')
  })

  it('updates page type', () => {
    const page = service.createPage(db, {
      title: 'Type Test',
      pageType: 'rich',
      content: '',
    })
    const updated = service.updatePage(db, page.id, {
      pageType: 'html',
    })
    expect(updated!.pageType).toBe('html')
  })

  it('returns null when updating non-existent page', () => {
    const result = service.updatePage(
      db,
      '00000000-0000-0000-0000-000000000000',
      { title: 'x' },
    )
    expect(result).toBeNull()
  })

  it('lists pages sorted by updated_at desc', async () => {
    const p1 = service.createPage(db, {
      title: 'First',
      pageType: 'rich',
      content: '',
    })
    await new Promise((r) => setTimeout(r, 10))
    const p2 = service.createPage(db, {
      title: 'Second',
      pageType: 'rich',
      content: '',
    })

    const result = service.listPages(db)
    expect(result.pages.length).toBeGreaterThanOrEqual(2)
    expect(result.pages[0].id).toBe(p2.id)
    expect(result.pages[1].id).toBe(p1.id)
  })

  it('searches pages by title', () => {
    service.createPage(db, {
      title: 'Quantum Physics Notes',
      pageType: 'rich',
      content: 'quarks',
    })
    service.createPage(db, {
      title: 'History Timeline',
      pageType: 'rich',
      content: 'dates',
    })

    const result = service.listPages(db, {
      search: 'Physics',
    })
    expect(
      result.pages.some((p) => p.title === 'Quantum Physics Notes'),
    ).toBe(true)
    expect(
      result.pages.some((p) => p.title === 'History Timeline'),
    ).toBe(false)
  })

  it('searches pages by content', () => {
    service.createPage(db, {
      title: 'Notes',
      pageType: 'rich',
      content: 'The mitochondria is the powerhouse',
    })
    const result = service.listPages(db, {
      search: 'mitochondria',
    })
    expect(
      result.pages.some((p) => p.title === 'Notes'),
    ).toBe(true)
  })

  it('duplicates a page with new id and copy suffix', () => {
    const original = service.createPage(db, {
      title: 'Original Page',
      pageType: 'rich',
      content: 'content here',
    })
    const copy = service.duplicatePage(db, original.id)
    expect(copy).not.toBeNull()
    expect(copy!.id).not.toBe(original.id)
    expect(copy!.title).toBe('Original Page - Copy')
    expect(copy!.content).toBe('content here')
    expect(copy!.pageType).toBe('rich')
  })

  it('returns null when duplicating non-existent page', () => {
    const result = service.duplicatePage(
      db,
      '00000000-0000-0000-0000-000000000000',
    )
    expect(result).toBeNull()
  })

  it('soft-deletes a page', () => {
    const page = service.createPage(db, {
      title: 'Delete Me',
      pageType: 'rich',
      content: '',
    })
    const deleted = service.softDeletePage(db, page.id)
    expect(deleted).toBe(true)
    const fetched = service.getPage(db, page.id)
    expect(fetched).toBeNull()
  })

  it('returns false when soft-deleting non-existent page', () => {
    const result = service.softDeletePage(
      db,
      '00000000-0000-0000-0000-000000000000',
    )
    expect(result).toBe(false)
  })

  it('does not list soft-deleted pages', () => {
    const page = service.createPage(db, {
      title: 'Gone Soon',
      pageType: 'rich',
      content: '',
    })
    service.softDeletePage(db, page.id)
    const result = service.listPages(db)
    expect(
      result.pages.some((p) => p.id === page.id),
    ).toBe(false)
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
          content: [
            {
              type: 'text',
              text: 'Hello',
              styles: {},
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'World',
              styles: { bold: true },
            },
          ],
        },
      ],
    })
    const page = service.createPage(db, {
      title: 'JSON Test',
      pageType: 'rich',
      content: blockNoteJson,
    })
    const fetched = service.getPage(db, page.id)
    expect(fetched!.content).toBe(blockNoteJson)
    const parsed = JSON.parse(fetched!.content)
    expect(parsed.children[0].type).toBe('heading')
    expect(parsed.children[0].content[0].text).toBe('Hello')
  })

  it('preserves content through update cycle', () => {
    const original = JSON.stringify({
      type: 'blockContainer',
      children: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'v1',
              styles: {},
            },
          ],
        },
      ],
    })
    const page = service.createPage(db, {
      title: 'Update Test',
      pageType: 'rich',
      content: original,
    })
    const updatedContent = JSON.stringify({
      type: 'blockContainer',
      children: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'v2',
              styles: {},
            },
          ],
        },
      ],
    })
    service.updatePage(db, page.id, {
      content: updatedContent,
    })
    const fetched = service.getPage(db, page.id)
    expect(fetched!.content).toBe(updatedContent)
  })
})

describe('HTML content round trip', () => {
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

  it('stores and retrieves HTML page content', () => {
    const htmlContent = JSON.stringify({
      html: '<h1>Title</h1><p>Body</p>',
      css: 'body { color: red; }',
      js: 'console.log("hi")',
      jsEnabled: false,
      schemaVersion: 1,
      sandboxPolicyVersion: 1,
    })
    const page = service.createPage(db, {
      title: 'HTML Test',
      pageType: 'html',
      content: htmlContent,
    })
    const fetched = service.getPage(db, page.id)
    expect(fetched!.pageType).toBe('html')
    const parsed = JSON.parse(fetched!.content)
    expect(parsed.html).toBe('<h1>Title</h1><p>Body</p>')
    expect(parsed.jsEnabled).toBe(false)
  })
})

describe('API validation', () => {
  it('CreatePageSchema rejects empty title', async () => {
    const { CreatePageSchema } = await import(
      '@rtwiki/shared/schemas/pages'
    )
    const result = CreatePageSchema.safeParse({ title: '' })
    expect(result.success).toBe(false)
  })

  it('CreatePageSchema rejects title over 200 chars', async () => {
    const { CreatePageSchema } = await import(
      '@rtwiki/shared/schemas/pages'
    )
    const result = CreatePageSchema.safeParse({
      title: 'x'.repeat(201),
    })
    expect(result.success).toBe(false)
  })

  it('CreatePageSchema accepts valid input', async () => {
    const { CreatePageSchema } = await import(
      '@rtwiki/shared/schemas/pages'
    )
    const result = CreatePageSchema.safeParse({
      title: 'Valid Title',
    })
    expect(result.success).toBe(true)
  })

  it('UpdatePageSchema accepts partial updates', async () => {
    const { UpdatePageSchema } = await import(
      '@rtwiki/shared/schemas/pages'
    )
    const result = UpdatePageSchema.safeParse({
      title: 'New Title',
    })
    expect(result.success).toBe(true)
  })

  it('UpdatePageSchema rejects empty title', async () => {
    const { UpdatePageSchema } = await import(
      '@rtwiki/shared/schemas/pages'
    )
    const result = UpdatePageSchema.safeParse({ title: '' })
    expect(result.success).toBe(false)
  })
})