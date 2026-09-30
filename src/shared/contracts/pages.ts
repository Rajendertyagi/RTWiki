/**
 * The page types RTWiki writes.
 *
 * `mindmap` was retired. It was a second Mermaid page identical to `diagram` bar
 * one ternary and two starter strings, and Mermaid's `mindmap` is an ordinary
 * diagram type offered from the shared template list. Existing rows are
 * rewritten to `diagram` by migration `010_mindmap_pages_to_diagram`; a stored
 * page's own inner `type` marker is normalised on read, so no other rewrite is
 * needed. See docs/adr/ADR-019-one-mermaid-page-and-block.md.
 */
export type PageType = 'rich' | 'html' | 'diagram' | 'markdown'

export interface Page {
  id: string
  title: string
  content: string
  pageType: PageType
  /** Parent page id; `null` for root pages. */
  parentId: string | null
  /** Zero-based position among living siblings. */
  position: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  version: number
}

export interface CreatePageRequest {
  title: string
  pageType?: PageType
  content?: string
  /** Optional parent; omitted/NULL creates a root page. */
  parentId?: string | null
}

export interface UpdatePageRequest {
  title?: string
  content?: string
  /**
   * The page version the caller last read. Optional only because the client API
   * (`web/services/pages-api.ts`) tracks it per page and fills it in; when it is
   * given it always wins. The SERVER requires it: the write is applied only if
   * this is still the stored version, otherwise 409.
   */
  version?: number
  // pageType deliberately absent: conversion is not supported in Phase 4A.
}

export interface PageListResponse {
  pages: Page[]
  total: number
}
