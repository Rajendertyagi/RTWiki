export type PageType = 'rich' | 'html'

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
  // pageType deliberately absent: conversion is not supported in Phase 4A.
}

export interface PageListResponse {
  pages: Page[]
  total: number
}
