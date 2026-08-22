export type PageType = 'rich' | 'html'

export interface Page {
  id: string
  title: string
  content: string
  pageType: PageType
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  version: number
}

export interface CreatePageRequest {
  title: string
  pageType?: PageType
  content?: string
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
