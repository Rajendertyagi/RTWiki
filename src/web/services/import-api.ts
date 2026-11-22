import type { Page } from '@rtwiki/shared/contracts/pages'

const API_BASE = '/api'

interface ApiError {
  error: string
  code?: string
}

/** The attachment record the server reads back after a successful import. */
export interface ImportedAttachment {
  id: string
  mimeType: string
  byteSize: number
  kind: 'image' | 'document'
  extractedText: string | null
  originalName: string | null
  checksum: string | null
  createdAt: string
}

/** The provenance snapshot written in the same transaction as the page. */
export interface ImportProvenance {
  id: string
  pageId: string
  attachmentId: string
  sourceKind: string
  originalName: string
  byteSize: number
  checksum: string
  mimeType: string
  createdAt: string
}

export interface ImportWarning {
  code: string
  message: string
}

export interface ImportResult {
  page: Page
  attachment: ImportedAttachment
  provenance: ImportProvenance
  warnings: ImportWarning[]
}

/**
 * Sends one file through the server's single ingest pipeline and returns the
 * page, attachment, provenance and warnings it committed together.
 *
 * The browser never reads the file: detection, conversion and storage all
 * happen server-side, so the client cannot disagree with the server about what
 * was imported. A refusal is surfaced as an `Error` carrying the server's own
 * message, which the picker shows next to the control the user pressed.
 */
export async function importFile(
  file: File,
  opts?: { title?: string; parentId?: string }
): Promise<ImportResult> {
  const form = new FormData()
  form.append('file', file)
  if (opts?.title !== undefined) form.append('title', opts.title)
  if (opts?.parentId !== undefined) form.append('parentId', opts.parentId)
  form.append('source', JSON.stringify({ kind: 'file' }))

  const res = await fetch(`${API_BASE}/import`, { method: 'POST', body: form })
  if (!res.ok) {
    const body = (await res.json()) as ApiError
    throw new Error(body.error || `Failed to import file (${res.status})`)
  }
  return (await res.json()) as ImportResult
}
