export type PageType = 'rich' | 'html'

export type Page = {
  id: string
  title: string
  content: string
  pageType: PageType
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  version: number
}

export type CreatePageRequest = {
  title: string
  pageType?: PageType
  content?: string
}

export type UpdatePageRequest = {
  title?: string
  content?: string
  pageType?: PageType
}

export type PageListResponse = {
  pages: Page[]
  total: number
}

export type PageResponse = {
  page: Page
}

export type DuplicatePageResponse = {
  page: Page
}
