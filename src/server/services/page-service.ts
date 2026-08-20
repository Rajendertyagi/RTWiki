import type { Database } from 'bun:sqlite'
import type { Page, PageType } from '@rtwiki/shared/contracts/pages'
import type { CreatePageInput, UpdatePageInput } from '@rtwiki/shared/schemas/pages'
import * as repo from '../repositories/page-repository.js'

export function createPage(db: Database, input: CreatePageInput): Page {
  const id = crypto.randomUUID()
  return repo.createPage(db, id, input.title, input.pageType, input.content)
}

export function getPage(db: Database, id: string): Page | null {
  return repo.getPage(db, id)
}

export function getPageOrThrow(db: Database, id: string): Page {
  return repo.getPageOrThrow(db, id)
}

export function updatePage(db: Database, id: string, input: UpdatePageInput): Page | null {
  return repo.updatePage(db, id, input)
}

export function duplicatePage(db: Database, id: string): Page | null {
  return repo.duplicatePage(db, id)
}

export function softDeletePage(db: Database, id: string): boolean {
  return repo.softDeletePage(db, id)
}

export function listPages(
  db: Database,
  options: { search?: string; limit?: number; offset?: number } = {}
): { pages: Page[]; total: number } {
  return repo.listPages(db, options)
}