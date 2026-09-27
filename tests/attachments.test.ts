import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { getAttachment, listAttachments } from '../src/server/attachments/attachment-repository.js'
import { createAttachmentRoutes } from '../src/server/attachments/attachment-routes.js'
import { closeDatabase, type getDb, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import type { LogContext, Logger } from '../src/server/logging/index.js'
import { ATTACHMENTS_DIR } from '../src/shared/constants/index.js'

/** A real, valid 1x1 PNG. Detection reads the signature; the test still uses a real image. */
const REAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

const HTML_WITH_SCRIPT = Buffer.from(
  '<html><body><script>alert(document.domain)</script></body></html>',
  'utf8'
)
const SVG_WITH_SCRIPT = Buffer.from(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  'utf8'
)

/**
 * A structurally valid PNG whose IHDR declares the given dimensions.
 *
 * The pixel limit is read from the header, so a test needs a real PNG structure
 * carrying chosen dimensions. The image data is a single valid (if visually
 * meaningless) scanline, which keeps the file small while the declared size is
 * large - exactly the shape of a deliberately hostile upload.
 */
function pngWithDimensions(width: number, height: number): Buffer {
  // IHDR is always 13 bytes: width(4) height(4) depth(1) colour(1) ... crc(4)
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = 8 // bit depth
  ihdrData[9] = 2 // colour type: truecolour
  const ihdr = chunk('IHDR', ihdrData)
  const idat = chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01]))
  const iend = chunk('IEND', Buffer.alloc(0))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
    idat,
    iend
  ])
}

/** A PNG chunk: length, type, data, CRC. The CRC is not validated by the reader. */
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  return out
}

class MemoryLogger implements Logger {
  readonly lines: string[] = []

  info(message: string, context?: LogContext): void {
    this.push(message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.push(message, context)
  }

  error(message: string, context?: LogContext): void {
    this.push(message, context)
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {}

  private push(message: string, context?: LogContext): void {
    this.lines.push(JSON.stringify({ message, ...(context ?? {}) }))
  }
}

let tempDir: string
let attachmentsDir: string
let db: ReturnType<typeof getDb>
let app: Hono

/** Posts a file, letting the caller lie about its name and declared type. */
async function upload(
  bytes: Uint8Array,
  fileName: string,
  declaredType: string
): Promise<Response> {
  const body = new FormData()
  body.append('file', new File([bytes as unknown as BlobPart], fileName, { type: declaredType }))
  return await app.request('/api/attachments', { method: 'POST', body })
}

beforeAll(async () => {
  tempDir = join(
    tmpdir(),
    `rtwiki-attachment-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  // Still created and still passed to the migration: a database created before
  // ADR-014 keeps its image files here, and the migration reads from it. Nothing
  // writes to it now (ADR-014).
  attachmentsDir = join(tempDir, ATTACHMENTS_DIR)
  mkdirSync(attachmentsDir, { recursive: true })
  db = initDatabase(tempDir)
  await runMigrations(db, attachmentsDir)
  app = new Hono().route(
    '/api/attachments',
    createAttachmentRoutes({ getDb: () => db, logger: new MemoryLogger() })
  )
})

afterAll(async () => {
  await closeDatabase()
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // A leftover temp directory is not a test failure.
  }
})

describe('image upload', () => {
  it('stores a real image and returns a URL that serves those bytes', async () => {
    const response = await upload(REAL_PNG, 'diagram.png', 'image/png')
    expect(response.status).toBe(201)

    const payload = (await response.json()) as {
      attachment: { id: string; url: string; mimeType: string; byteSize: number }
    }
    expect(payload.attachment.mimeType).toBe('image/png')
    expect(payload.attachment.byteSize).toBe(REAL_PNG.byteLength)
    expect(payload.attachment.url).toBe(`/api/attachments/${payload.attachment.id}`)

    // The URL is what the document stores, so it has to actually serve the image.
    const served = await app.request(payload.attachment.url)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    // A browser must not second-guess the type and reinterpret the bytes.
    expect(served.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array(REAL_PNG))
  })

  it('serves a type detected from the bytes, not the one the request claimed', async () => {
    // A real GIF sent while claiming to be a PNG: the recorded type must be the
    // truth, because that is the type the server will later serve.
    const gif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(8)])
    const response = await upload(gif, 'mislabelled.png', 'image/png')
    expect(response.status).toBe(201)
    const payload = (await response.json()) as { attachment: { mimeType: string; url: string } }
    expect(payload.attachment.mimeType).toBe('image/gif')

    const served = await app.request(payload.attachment.url)
    expect(served.headers.get('content-type')).toBe('image/gif')
  })
})

describe('upload rejection by content', () => {
  it('rejects markup and SVG however they are labelled', async () => {
    // The security property: a file whose bytes are executable is refused no
    // matter what its name or Content-Type says, so no stored image can be a
    // script.
    expect((await upload(HTML_WITH_SCRIPT, 'evil.png', 'image/png')).status).toBe(415)
    expect((await upload(SVG_WITH_SCRIPT, 'evil.png', 'image/png')).status).toBe(415)
    expect((await upload(HTML_WITH_SCRIPT, 'evil', 'image/jpeg')).status).toBe(415)
  })

  it('stores nothing when a file is rejected', async () => {
    // Asserted against the database, which is where the bytes now live
    // (ADR-014). Counting rows is the direct statement of "nothing was stored".
    const before = listAttachments(db).length
    await upload(SVG_WITH_SCRIPT, 'rejected.png', 'image/png')
    expect(listAttachments(db).length).toBe(before)
    expect(listAttachments(db).every((a) => !a.originalName?.includes('rejected'))).toBe(true)
  })

  it('rejects an empty file', async () => {
    expect((await upload(new Uint8Array(0), 'empty.png', 'image/png')).status).toBe(400)
  })

  it('refuses an image whose header declares more pixels than the limit', async () => {
    // A real PNG whose IHDR claims 20,000 x 20,000 (400 MP, far over the 50 MP
    // ceiling) while the file stays tiny. This is the shape of the images built
    // to exhaust a decoder, and it is refused from the header alone - no decode.
    const oversized = pngWithDimensions(20_000, 20_000)
    const response = await upload(oversized, 'huge.png', 'image/png')
    expect(response.status).toBe(415)
    const payload = (await response.json()) as { code?: string }
    expect(payload.code).toBe('too_many_pixels')
  })

  it('accepts a large image that is within the limit', async () => {
    // 12 MP is a perfectly ordinary photograph and must not be caught by the rule
    // that refuses the 400 MP one.
    const response = await upload(pngWithDimensions(4000, 3000), 'photo.png', 'image/png')
    expect(response.status).toBe(201)
  })

  it('explains an SVG refusal, so the user learns the actual reason', async () => {
    // A generic "unsupported type" would leave a user who pasted a diagram
    // guessing. The reason code travels beside the message so the client can
    // choose words the user can act on without parsing English.
    const response = await upload(SVG_WITH_SCRIPT, 'diagram.png', 'image/png')
    expect(response.status).toBe(415)
    const payload = (await response.json()) as { code?: string; error?: string }
    expect(payload.code).toBe('svg_not_supported')
    expect(payload.error).toContain('SVG')
  })

  it('refuses a valid PNG signature followed by hostile content', async () => {
    // The leading bytes match a PNG, so a byte-signature check accepts this and
    // the file is then stored and served as image/png. Detection must read the
    // container, not just the signature.
    const forged = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      HTML_WITH_SCRIPT
    ])
    expect((await upload(forged, 'forged.png', 'image/png')).status).toBe(415)
  })

  it('rejects a request with no file at all', async () => {
    const response = await app.request('/api/attachments', { method: 'POST', body: new FormData() })
    expect(response.status).toBe(400)
  })
})

describe('a uploader filename never becomes anything executable', () => {
  it('stores a traversal filename as data and serves the image normally', async () => {
    // Since ADR-014 there is no path at all: the bytes are in the row and the
    // request names the row's id. So the strongest statement is available - the
    // string is inert data, and the image still works.
    const response = await upload(REAL_PNG, '../../../etc/passwd', 'image/png')
    expect(response.status).toBe(201)
    const payload = (await response.json()) as { attachment: { id: string; url: string } }

    const served = await app.request(payload.attachment.url)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array(REAL_PNG))

    // The name is kept only as a cleaned display string, never as a path.
    const stored = getAttachment(db, payload.attachment.id)
    expect(stored?.originalName).not.toContain('/')
    expect(stored?.originalName).not.toContain('\\')
  })

  it('records the original name as data, cleaned of separators and control characters', async () => {
    // Separators and control characters are dropped; a space *inside* a name is
    // legitimate and is kept, because "my shot.png" is a name a person wrote.
    const response = await upload(REAL_PNG, 'my\\shot .png', 'image/png')
    expect(response.status).toBe(201)
    const payload = (await response.json()) as { attachment: { originalName: string } }
    expect(payload.attachment.originalName).toBe('myshot .png')
  })
})

describe('attachment lookup and removal', () => {
  it('reports a missing id as not found', async () => {
    const response = await app.request('/api/attachments/00000000-0000-4000-8000-000000000000')
    expect(response.status).toBe(404)
  })

  it('removes the bytes and the metadata in one step', async () => {
    // The reason this test can be simple is the point of ADR-014: there is no
    // second filesystem step that could fail and leave a row pointing at nothing.
    const created = (await (await upload(REAL_PNG, 'temporary.png', 'image/png')).json()) as {
      attachment: { id: string; url: string }
    }
    expect(getAttachment(db, created.attachment.id)).not.toBeNull()

    const removed = await app.request(`/api/attachments/${created.attachment.id}`, {
      method: 'DELETE'
    })
    expect(removed.status).toBe(200)
    expect(getAttachment(db, created.attachment.id)).toBeNull()
    // The bytes went with it: the row that held them no longer exists.
    const stored = db
      .query('SELECT length(data) AS size FROM attachments WHERE id = ?')
      .get(created.attachment.id)
    expect(stored).toBeNull()
    expect((await app.request(created.attachment.url)).status).toBe(404)
  })

  it('reports a missing id on removal rather than failing', async () => {
    const response = await app.request('/api/attachments/not-a-real-id', { method: 'DELETE' })
    expect(response.status).toBe(404)
  })
})
describe('upload origin checks', () => {
  it('refuses a cross-origin upload', async () => {
    const response = await app.request('/api/attachments', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
      body: (() => {
        const body = new FormData()
        body.append(
          'file',
          new File([REAL_PNG as unknown as BlobPart], 'x.png', { type: 'image/png' })
        )
        return body
      })()
    })
    expect(response.status).toBe(403)
  })

  it('allows a same-origin upload', async () => {
    const response = await upload(REAL_PNG, 'allowed.png', 'image/png')
    expect(response.status).toBe(201)
  })
})
