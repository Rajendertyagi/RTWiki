import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, type getDb, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import * as repo from '../src/server/repositories/page-repository.js'
import * as service from '../src/server/services/page-service.js'
import {
  buildInternalLinkHref,
  extractPageLinks,
  findLinkContext,
  RTWIKI_LINK_PREFIX
} from '../src/shared/schemas/page-links.js'

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `rtwiki-links-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

function paragraphWithLink(
  id: string,
  targetId: string,
  text = 'see related'
): Record<string, unknown> {
  return {
    id,
    type: 'paragraph',
    content: [
      { type: 'text', text: `${text} `, styles: {} },
      {
        type: 'link',
        href: buildInternalLinkHref(targetId),
        content: [{ type: 'text', text: 'Target', styles: {} }]
      }
    ]
  }
}

describe('internal link extraction', () => {
  it('extracts internal targets and deduplicates', () => {
    const doc = [
      paragraphWithLink('p1', 'aaaaaaaa-1111-2222-3333-444444444444'),
      {
        id: 'p2',
        type: 'paragraph',
        content: [
          {
            type: 'link',
            href: buildInternalLinkHref('aaaaaaaa-1111-2222-3333-444444444444'),
            content: []
          },
          { type: 'link', href: 'https://example.com', content: [] }
        ]
      }
    ]
    const links = extractPageLinks(JSON.stringify(doc))
    expect(links).toEqual(['aaaaaaaa-1111-2222-3333-444444444444'])
  })

  it('walks nested children', () => {
    const doc = [
      {
        id: 'list',
        type: 'bulletListItem',
        children: [paragraphWithLink('child', 'bbbbbbbb-1111-2222-3333-444444444444')]
      }
    ]
    expect(extractPageLinks(JSON.stringify(doc))).toEqual(['bbbbbbbb-1111-2222-3333-444444444444'])
  })

  it('ignores plain text resembling the scheme and malformed JSON', () => {
    const doc = [
      {
        id: 'p',
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: `go to ${RTWIKI_LINK_PREFIX}cccccccc-1111-2222-3333-444444444444 now`,
            styles: {}
          }
        ]
      }
    ]
    expect(extractPageLinks(JSON.stringify(doc))).toEqual([])
    expect(extractPageLinks('not json')).toEqual([])
    expect(extractPageLinks('{"blocks": "nope"}')).toEqual([])
  })

  it('never indexes unsupported-block preservation payloads', () => {
    const doc = [
      {
        id: 'code',
        type: 'codeBlock',
        props: { language: 'json' },
        content: `[unsupported block preserved below]\n{"link":"${RTWIKI_LINK_PREFIX}dddddddd-1111-2222-3333-444444444444"}`
      }
    ]
    // The payload is a plain string inside a code block — never link marks.
    expect(extractPageLinks(JSON.stringify(doc))).toEqual([])
  })

  it('finds readable context around a link occurrence', () => {
    const targetId = 'eeeeeeee-1111-2222-3333-444444444444'
    const doc = [paragraphWithLink('p', targetId, 'Read the chapter')]
    // Snippet = preceding inline text plus the link's own words.
    expect(findLinkContext(JSON.stringify(doc), targetId)).toContain('Read the chapter')
    expect(findLinkContext(JSON.stringify(doc), targetId)).toContain('Target')
    expect(findLinkContext(JSON.stringify(doc), 'ffffffff-1111-2222-3333-444444444444')).toBeNull()
  })
})

describe('page_links index maintenance', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>

  beforeAll(async () => {
    tempDir = makeTempDir()
    db = initDatabase(tempDir)
    await runMigrations(db)
  })

  afterAll(async () => {
    await closeDatabase()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('maintains outgoing links on create, update, duplicate and delete', () => {
    const target = service.createPage(db, { title: 'Link Target', pageType: 'rich', content: '' })
    const sourceContent = JSON.stringify([paragraphWithLink('p', target.id)])
    const source = service.createPage(db, {
      title: 'Source',
      pageType: 'rich',
      content: sourceContent
    })

    // Created with a link → indexed.
    expect(repo.listBacklinks(db, target.id).map((r) => r.id)).toEqual([source.id])

    // Update removing the link → row removed.
    service.updatePage(db, source.id, { content: JSON.stringify([]) })
    expect(repo.listBacklinks(db, target.id)).toEqual([])

    // Re-add, then duplicate the source → copy carries the same outgoing link.
    service.updatePage(db, source.id, { content: sourceContent })
    const copy = service.duplicatePage(db, source.id)
    expect(copy).not.toBeNull()
    const backlinks = repo.listBacklinks(db, target.id).map((r) => r.id)
    expect(backlinks).toContain(source.id)
    expect(copy?.id).toBeDefined()
    expect(backlinks).toContain(copy?.id as string)

    // Deleting the copy removes only its own outgoing links.
    const copyId = copy?.id
    expect(copyId).toBeDefined()
    service.softDeletePage(db, copyId as string)
    expect(repo.listBacklinks(db, target.id).map((r) => r.id)).toEqual([source.id])
  })

  it('keeps incoming links when the target is deleted (broken links)', () => {
    const target = service.createPage(db, { title: 'Doomed Target', pageType: 'rich', content: '' })
    const source = service.createPage(db, {
      title: 'Holder',
      pageType: 'rich',
      content: JSON.stringify([paragraphWithLink('p', target.id)])
    })
    service.softDeletePage(db, target.id)
    // The relationship survives so the source can render/repair the broken link.
    expect(repo.listBacklinks(db, target.id).map((r) => r.id)).toEqual([source.id])
  })

  it('clears outgoing links when a rich page converts to non-rich storage', () => {
    const target = service.createPage(db, { title: 'T2', pageType: 'rich', content: '' })
    const source = service.createPage(db, {
      title: 'S2',
      pageType: 'rich',
      content: JSON.stringify([paragraphWithLink('p', target.id)])
    })
    // Overwrite with HTML-page-shaped content is impossible via PATCH (type
    // immutable), but a rich save without links must clear the set.
    service.updatePage(db, source.id, { content: JSON.stringify([]) })
    expect(repo.listBacklinks(db, target.id)).toEqual([])
  })

  it('returns backlinks beyond the first 50 pages correctly', () => {
    const target = service.createPage(db, { title: 'Hub', pageType: 'rich', content: '' })
    for (let i = 0; i < 55; i++) {
      service.createPage(db, {
        title: `Linker ${i}`,
        pageType: 'rich',
        content: JSON.stringify([paragraphWithLink(`p${i}`, target.id)])
      })
    }
    const backlinks = service.listBacklinks(db, target.id)
    expect(backlinks.length).toBeGreaterThanOrEqual(55)
    expect(backlinks.every((b) => b.title.startsWith('Linker'))).toBe(true)
  })
})
