/**
 * Random document fuzz runner for the BUILT RTWiki app.
 *
 * Generates random files for every format RTWiki accepts, uploads each to a
 * built executable running in an isolated copy of the portable folder, checks
 * the result, and cleans up. Never touches the real portable folder or its data.
 *
 * Run explicitly (NOT part of `bun test`):
 *   bun scripts/ci/random-document-runner.ts
 *   bun scripts/ci/random-document-runner.ts --seed 12345
 *   bun scripts/ci/random-document-runner.ts --big
 *   bun scripts/ci/random-document-runner.ts --real-files D:\my-real-docs
 *   bun scripts/ci/random-document-runner.ts --failure-dir D:\fuzz-failures
 *
 * See docs/DOCUMENT_FUZZ_RUNNER.md for how to read the table.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { evaluateDamage } from './damage-rule.js'

const require = createRequire(import.meta.url)
const { parseOffice, generate } = require('officeparser') as {
  parseOffice: (b: Uint8Array, o?: Record<string, unknown>) => Promise<unknown>
  generate: (ast: unknown, fmt: string) => Promise<{ value: string | Uint8Array }>
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`)

const BIG_MODE = hasFlag('big')
const SEED_ARG = arg('seed')
const REAL_FILES_DIR = arg('real-files')
const FAILURE_DIR = resolve(arg('failure-dir') ?? join(tmpdir(), 'rtwiki-doc-fuzz-failures'))
const PORTABLE = resolve(arg('portable') ?? 'D:\\RTWiki-0.1.0-desktop-windows-x64')
const SERVER_EXE = resolve(arg('server') ?? 'D:\\Temp\\RTWiki\\build\\server\\RTWiki.exe')
const PORT = 18080 // isolated port, never the real 8080/8888
const BASE = `http://127.0.0.1:${PORT}`
const PER_FILE_TIMEOUT_MS = 15_000

// Seeded PRNG (mulberry32)
function makeRng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const SEED = SEED_ARG !== undefined ? Number(SEED_ARG) >>> 0 : (Math.random() * 0xffffffff) >>> 0
const rng = makeRng(SEED)
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!
const randInt = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1))

// ---------------------------------------------------------------------------
// Content generation — languages, structures, sizes
// ---------------------------------------------------------------------------
const WORDS: Record<string, string[]> = {
  en: [
    'photosynthesis',
    'chloroplast',
    'glucose',
    'mitochondria',
    'enzyme',
    'reaction',
    'energy',
    'cycle',
    'calvin',
    'atp'
  ],
  ar: [
    'التمثيل الضوئي',
    'البلاستيدات الخضراء',
    'الجلوكوز',
    'الميتوكوندريا',
    'إنزيم',
    'طاقة',
    'دورة',
    'كالفن'
  ],
  zh: ['光合作用', '叶绿体', '葡萄糖', '线粒体', '酶', '能量', '循环', '卡尔文'],
  emoji: ['🌱', '☀️', '💧', '🧪', '🔬', '⚡', '🌿', '✨'],
  accent: ['café', 'naïve', 'résumé', 'über', 'señor', 'niño', 'crème', 'fiancé']
}
const MARKER_PREFIX = 'MARKER'

function randomWord(): string {
  const lang = pick(Object.keys(WORDS))
  return pick(WORDS[lang]!)
}

function randomText(targetChars: number, markers: string[]): string {
  // Guarantee every marker is present. The probabilistic insertion below alone
  // can omit one on a short document, which makes a perfectly good generator
  // look broken when the marker check fails.
  const parts: string[] = [...markers]
  let n = markers.reduce((sum, m) => sum + m.length + 1, 0)
  while (n < targetChars) {
    if (rng() < 0.08 && markers.length > 0) {
      const m = pick(markers)
      parts.push(m)
      n += m.length
    } else {
      const w = randomWord()
      parts.push(w)
      n += w.length + 1
    }
    if (rng() < 0.05) parts.push('\n')
  }
  return parts.join(' ')
}

function makeMarkers(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${MARKER_PREFIX}${SEED.toString(36)}${i}`)
}

// ---------------------------------------------------------------------------
// ZIP builder (from tests/document-detect.test.ts) — no dependency
// ---------------------------------------------------------------------------
const enc = (s: string) => new TextEncoder().encode(s)
const CRC_TABLE = (() => {
  const t: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function zip(files: Array<[string, string]>): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, content] of files) {
    const nb = enc(name)
    const cb = enc(content)
    const comp = deflateRawSync(cb)
    const crc = crc32(cb)
    const local = new Uint8Array(30 + nb.length + comp.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0, true)
    lv.setUint16(8, 8, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, comp.length, true)
    lv.setUint32(22, cb.length, true)
    lv.setUint16(26, nb.length, true)
    local.set(nb, 30)
    local.set(comp, 30 + nb.length)
    parts.push(local)
    const cen = new Uint8Array(46 + nb.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0, true)
    cv.setUint16(10, 8, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, comp.length, true)
    cv.setUint32(24, cb.length, true)
    cv.setUint16(28, nb.length, true)
    cv.setUint32(42, offset, true)
    cen.set(nb, 46)
    central.push(cen)
    offset += local.length
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  // Copy the chunks into one buffer. Spreading them into `new Uint8Array([...])`
  // converts each Uint8Array to a number (NaN -> 0), which silently produced a
  // 5-byte file of NULs for every hand-built container. The unit-test zip() in
  // tests/document-detect.test.ts does this correctly; mirror it here.
  const out = new Uint8Array(offset + centralSize + 22)
  let p = 0
  for (const chunk of parts) {
    out.set(chunk, p)
    p += chunk.length
  }
  for (const chunk of central) {
    out.set(chunk, p)
    p += chunk.length
  }
  out.set(end, p)
  return out
}

/**
 * Reads the entries back out of a ZIP produced by `zip()` or by OfficeGenerator.
 * Used to repackage a generated base document as a macro/template variant: the
 * base is a real, parseable file, and only its main-part content-type changes.
 */
function readZip(bytes: Uint8Array): Array<[string, string]> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('ZIP has no end-of-central-directory record')
  const total = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const entries: Array<[string, string]> = []
  for (let i = 0; i < total; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad central-directory header')
    const method = dv.getUint16(p + 10, true)
    const compSize = dv.getUint32(p + 20, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOffset = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen))
    const localNameLen = dv.getUint16(localOffset + 26, true)
    const localExtraLen = dv.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const comp = bytes.subarray(dataStart, dataStart + compSize)
    const raw =
      method === 0
        ? comp
        : method === 8
          ? new Uint8Array(inflateRawSync(comp))
          : (() => {
              throw new Error(`unsupported ZIP compression method ${method}`)
            })()
    entries.push([name, new TextDecoder().decode(raw)])
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** The base format each macro/template variant is repackaged from. */
const VARIANT_BASE: Record<string, string> = {
  docm: 'docx',
  dotx: 'docx',
  dotm: 'docx',
  pptm: 'pptx',
  potx: 'pptx',
  potm: 'pptx',
  ppsx: 'pptx',
  ppsm: 'pptx',
  xlsm: 'xlsx',
  xltx: 'xlsx',
  xltm: 'xlsx'
}

/**
 * Repackages a generated base document as a macro/template variant by changing
 * only the main part's content-type override. Every other part — relationships,
 * styles, slides, worksheets, document text — is kept exactly as generated, so
 * the file is a real, parseable Office document rather than a minimal stub.
 */
function repackageVariant(base: Uint8Array, ext: string): Uint8Array {
  const entries = readZip(base)
  const idx = entries.findIndex(([name]) => name === '[Content_Types].xml')
  if (idx < 0) throw new Error('generated base has no [Content_Types].xml')
  const isWord = ['docm', 'dotx', 'dotm'].includes(ext)
  const isPpt = ['pptm', 'potx', 'potm', 'ppsx', 'ppsm'].includes(ext)
  const mainPart = isWord
    ? '/word/document.xml'
    : isPpt
      ? '/ppt/presentation.xml'
      : '/xl/workbook.xml'
  const variantMime = OOXML_CONTENT_TYPES[ext]!
  const original = entries[idx]![1]
  const replaced = original.replace(
    new RegExp(`(<Override PartName="${mainPart}" ContentType=")[^"]*(")`),
    `$1${variantMime}$2`
  )
  if (replaced === original) throw new Error(`no main-part override for ${mainPart}`)
  entries[idx] = ['[Content_Types].xml', replaced]
  return zip(entries)
}

/**
 * The minimal PDF uses the Helvetica / latin1 font and cannot represent Arabic,
 * Chinese, emoji or accented letters. Keep its text plain ASCII English so every
 * word and marker is actually extractable; multilingual PDFs need a real file.
 */
function plainEnglish(text: string): string {
  return text.replace(/[^\x20-\x7E]/g, ' ')
}

// Minimal PDF (from tests/document-detect.test.ts)
function makePdf(body: string): Uint8Array {
  const esc = body.replace(/[()\\]/g, (m) => `\\${m}`)
  const stream = `BT /F1 12 Tf 72 720 Td (${esc}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) pdf += `${o.toString().padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new Uint8Array(Buffer.from(pdf, 'latin1'))
}

// ---------------------------------------------------------------------------
// Format definitions — source label on every row
// ---------------------------------------------------------------------------
type Source = 'generator' | 'handbuilt' | 'fixture' | 'real'
interface FormatDef {
  ext: string
  mime: string
  source: Source
  generate: (text: string, markers: string[]) => Uint8Array
}

const OOXML_CONTENT_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  docm: 'application/vnd.ms-word.document.macroEnabled.main+xml',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
  dotm: 'application/vnd.ms-word.template.macroEnabledTemplate.main+xml',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml',
  potm: 'application/vnd.ms-powerpoint.template.macroEnabled.main+xml',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml',
  ppsm: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml',
  xltm: 'application/vnd.ms-excel.template.macroEnabled.main+xml'
}
const ODF_MIMES: Record<string, string> = {
  odt: 'application/vnd.oasis.opendocument.text',
  odp: 'application/vnd.oasis.opendocument.presentation',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odg: 'application/vnd.oasis.opendocument.graphics'
}

function ooxmlZip(ext: string, text: string): Uint8Array {
  const ct = OOXML_CONTENT_TYPES[ext]!
  const isWord = ['docx', 'docm', 'dotx', 'dotm'].includes(ext)
  const isPpt = ['pptx', 'pptm', 'potx', 'potm', 'ppsx', 'ppsm'].includes(ext)
  const mainName = isWord ? 'word/document.xml' : isPpt ? 'ppt/presentation.xml' : 'xl/workbook.xml'
  const rels = (target: string) =>
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/></Relationships>`
  const parts: Array<[string, string]> = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${mainName}" ContentType="${ct}"/>${isPpt ? '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' : ''}${!isWord && !isPpt ? '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' : ''}</Types>`
    ],
    ['_rels/.rels', rels(mainName)]
  ]
  if (isWord) {
    parts.push([
      mainName,
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
    ])
  } else if (isPpt) {
    parts.push([
      mainName,
      `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`
    ])
    parts.push([
      'ppt/_rels/presentation.xml.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    ])
    parts.push([
      'ppt/slides/slide1.xml',
      `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    ])
  } else {
    parts.push([
      mainName,
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`
    ])
    parts.push([
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
    ])
    parts.push([
      'xl/worksheets/sheet1.xml',
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${text}</t></is></c></row></sheetData></worksheet>`
    ])
  }
  return zip(parts)
}
function odfZip(ext: string, text: string): Uint8Array {
  const mime = ODF_MIMES[ext]!
  const ns =
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
    'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ' +
    'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"'
  const para = `<text:p>${text}</text:p>`
  const body =
    ext === 'odt'
      ? `<office:text>${para}</office:text>`
      : ext === 'odp'
        ? `<office:presentation><draw:page draw:name="Page 1"><draw:frame><draw:text-box>${para}</draw:text-box></draw:frame></draw:page></office:presentation>`
        : ext === 'ods'
          ? `<office:spreadsheet><table:table><table:table-row><table:table-cell>${para}</table:table-cell></table:table-row></table:table></office:spreadsheet>`
          : `<office:drawing><draw:page draw:name="Page 1"><draw:frame><draw:text-box>${para}</draw:text-box></draw:frame></draw:page></office:drawing>`
  return zip([
    ['mimetype', mime],
    [
      'content.xml',
      `<?xml version="1.0"?><office:document-content ${ns} office:version="1.2"><office:body>${body}</office:body></office:document-content>`
    ]
  ])
}
function epubZip(text: string): Uint8Array {
  return zip([
    ['mimetype', 'application/epub+zip'],
    [
      'META-INF/container.xml',
      `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    ],
    [
      'content.opf',
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title><dc:identifier id="id">test</dc:identifier></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`
    ],
    [
      'c1.xhtml',
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>${text}</p></body></html>`
    ]
  ])
}

const FORMATS: FormatDef[] = [
  {
    ext: 'pdf',
    mime: 'application/pdf',
    source: 'handbuilt',
    generate: (t) => makePdf(plainEnglish(t))
  },
  { ext: 'txt', mime: 'text/plain', source: 'handbuilt', generate: (t) => enc(t) },
  {
    ext: 'md',
    mime: 'text/markdown',
    source: 'handbuilt',
    generate: (t) => enc(`# Heading\n\n${t}`)
  },
  {
    ext: 'html',
    mime: 'text/html',
    source: 'handbuilt',
    generate: (t) => enc(`<html><body><h1>Heading</h1><p>${t}</p></body></html>`)
  },
  {
    ext: 'csv',
    mime: 'text/csv',
    source: 'handbuilt',
    generate: (t) => enc(`name,value\n${t},1\n`)
  },
  {
    ext: 'tex',
    mime: 'application/x-tex',
    source: 'handbuilt',
    generate: (t) =>
      enc(`\\documentclass{article}\\begin{document}\\section{Intro}\n${t}\n\\end{document}`)
  },
  {
    ext: 'rtf',
    mime: 'application/rtf',
    source: 'handbuilt',
    generate: (t) => enc(`{\\rtf1\\ansi ${t}}`)
  },
  ...Object.keys(OOXML_CONTENT_TYPES).map((ext) => ({
    ext,
    mime: '', // derived from allowlist at upload time
    source: 'handbuilt' as Source,
    generate: (t: string) => ooxmlZip(ext, t)
  })),
  ...Object.keys(ODF_MIMES).map((ext) => ({
    ext,
    mime: '',
    source: 'handbuilt' as Source,
    generate: (t: string) => odfZip(ext, t)
  })),
  { ext: 'epub', mime: 'application/epub+zip', source: 'handbuilt', generate: (t) => epubZip(t) }
]

// Generator-sourced formats (OfficeGenerator) — realistic structure
const GENERATOR_FORMATS = [
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'epub',
  'rtf',
  'html',
  'md',
  'csv',
  'tex'
]

async function generateWithOffice(
  fmt: string,
  text: string,
  markers: string[]
): Promise<Uint8Array | null> {
  try {
    // Put every marker in a table cell as well as in the prose. The random text
    // only inserts markers probabilistically, so without this a short document
    // can omit one and the marker check fails for a perfectly good generator.
    // OfficeGenerator carries table-cell text into every output format, csv
    // included (the app reads csv through its own text reader).
    const tableRows = markers.map((m, i) => `| ${m} | ${i} |`).join('\n')
    const ast = await parseOffice(
      enc(`# Heading\n\n${text}\n\n| A | B |\n|---|---|\n${tableRows}`),
      { fileType: 'md' }
    )
    const r = await generate(ast, fmt)
    const v = r.value
    const bytes = typeof v === 'string' ? enc(v) : (v as Uint8Array)
    return bytes.byteLength > 0 ? bytes : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// App lifecycle in an isolated folder
// ---------------------------------------------------------------------------
const RUN_ROOT = join(tmpdir(), `rtwiki-doc-fuzz-${SEED}`)
const APP_DIR = join(RUN_ROOT, 'app')
const GEN_DIR = join(RUN_ROOT, 'generated')
let serverProc: ChildProcess | null = null

function setupApp() {
  rmSync(RUN_ROOT, { recursive: true, force: true })
  mkdirSync(APP_DIR, { recursive: true })
  mkdirSync(GEN_DIR, { recursive: true })
  mkdirSync(FAILURE_DIR, { recursive: true })
  cpSync(PORTABLE, APP_DIR, { recursive: true })
  // Isolated data: remove the copied data so the app creates fresh state
  rmSync(join(APP_DIR, 'data'), { recursive: true, force: true })
  rmSync(join(APP_DIR, 'logs'), { recursive: true, force: true })
}

async function startApp(): Promise<boolean> {
  serverProc = spawn(SERVER_EXE, ['--no-open', '--port', String(PORT)], {
    cwd: APP_DIR,
    stdio: 'ignore',
    detached: false
  })
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) })
      if (r.status === 200) return true
    } catch {}
    await sleep(200)
  }
  return false
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
function stopApp() {
  if (serverProc && !serverProc.killed) {
    try {
      serverProc.kill('SIGKILL')
    } catch {}
  }
  serverProc = null
  sleep(500)
}

// ---------------------------------------------------------------------------
// Upload + check
// ---------------------------------------------------------------------------
interface Result {
  format: string
  source: Source
  files: number
  passed: number
  failed: number
  hangs: number
  skipped: number
  slowestMs: number
  seed: number
  note: string
  /** Damaged-phase only: how many uploads the app accepted vs refused. */
  accepted: number
  refused: number
}

/** Per (format, source) generators that failed their first check and were stopped. */
const brokenSources = new Set<string>()
const firstAttempt = new Set<string>()

function markBroken(format: string, source: Source, res?: Result): void {
  const key = `${format}:${source}`
  if (brokenSources.has(key)) return
  brokenSources.add(key)
  if (res) {
    const label = `${source}_broken`
    res.note = res.note ? `${res.note};${label}` : label
  }
}

async function upload(
  bytes: Uint8Array,
  ext: string,
  mime: string
): Promise<{ status: number; body: string; ms: number }> {
  const form = new FormData()
  form.append('file', new Blob([bytes as BlobPart], { type: mime }), `test.${ext}`)
  const start = performance.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PER_FILE_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/api/attachments`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
      headers: { Origin: BASE }
    })
    return { status: res.status, body: await res.text(), ms: performance.now() - start }
  } finally {
    clearTimeout(timer)
  }
}

async function getText(id: string): Promise<string> {
  try {
    const r = await fetch(`${BASE}/api/attachments/${id}/text`, { headers: { Origin: BASE } })
    if (!r.ok) return ''
    const j = (await r.json()) as { text?: string }
    return j.text ?? ''
  } catch {
    return ''
  }
}

function saveFailure(name: string, bytes: Uint8Array, reason: string) {
  const dir = join(FAILURE_DIR, String(SEED))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), bytes)
  writeFileSync(join(dir, `${name}.reason.txt`), reason)
}

// ---------------------------------------------------------------------------
// Damage variants
// ---------------------------------------------------------------------------
type Damage = 'truncate' | 'flip' | 'wrongext' | 'plainzip'
const DAMAGES: Damage[] = ['truncate', 'flip', 'wrongext', 'plainzip']

function damage(bytes: Uint8Array, kind: Damage): { bytes: Uint8Array; extOverride?: string } {
  const b = new Uint8Array(bytes)
  if (kind === 'truncate')
    return { bytes: b.subarray(0, Math.floor(b.length * (0.3 + rng() * 0.5))) }
  if (kind === 'flip') {
    for (let i = 0; i < 5; i++) b[randInt(0, b.length - 1)] = randInt(0, 255)
    return { bytes: b }
  }
  if (kind === 'wrongext') return { bytes: b, extOverride: 'pdf' }
  // plain zip: a valid zip that is not a document
  return { bytes: zip([['readme.txt', 'this is not a document']]) }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`SEED=${SEED} BIG=${BIG_MODE} FAILURE_DIR=${FAILURE_DIR}`)
  setupApp()
  if (!(await startApp())) {
    console.error('Could not start the built app')
    process.exit(1)
  }

  const results: Result[] = []
  const realManifest = REAL_FILES_DIR ? loadRealManifest(REAL_FILES_DIR) : []

  // Phase 1: validate the generator — every good generated file must pass.
  // Macro/template variants are validated too: their generator is the base file
  // plus the content-type repackaging, and a broken one must be stopped early.
  console.log('\n=== PHASE 1: generator validation (good files) ===')
  const generatorValidation: string[] = []
  const phase1Formats = [...GENERATOR_FORMATS, ...Object.keys(VARIANT_BASE)]
  for (const fmt of phase1Formats) {
    const markers = makeMarkers(2)
    const text = randomText(randInt(200, 2000), markers)
    let bytes: Uint8Array | null
    const variantBase = VARIANT_BASE[fmt]
    if (variantBase) {
      const base = await generateWithOffice(variantBase, text, markers)
      if (!base) bytes = null
      else {
        try {
          bytes = repackageVariant(base, fmt)
        } catch {
          bytes = null
        }
      }
    } else {
      bytes = await generateWithOffice(fmt, text, markers)
    }
    if (!bytes) {
      generatorValidation.push(
        `${fmt}: GENERATOR UNAVAILABLE (0 bytes) — generator problem or app problem?`
      )
      markBroken(fmt, 'generator')
      continue
    }
    const ext = fmt === 'md' ? 'md' : fmt === 'tex' ? 'tex' : fmt
    const mime = mimeForExt(ext)
    const r = await upload(bytes, ext, mime)
    if (r.status !== 201) {
      generatorValidation.push(
        `${fmt}: generator produced ${bytes.length} bytes but app returned ${r.status} ${r.body.slice(0, 120)} — generator problem or app problem?`
      )
      saveFailure(`gen-${fmt}.bin`, bytes, `status ${r.status}: ${r.body}`)
      markBroken(fmt, 'generator')
      continue
    }
    const id = (JSON.parse(r.body) as { attachment?: { id?: string } }).attachment?.id
    const out = id ? await getText(id) : ''
    const missing = markers.filter((m) => !out.includes(m))
    if (missing.length > 0) {
      generatorValidation.push(
        `${fmt}: marker words missing from extracted text (${missing.join(',')}) — generator problem or app problem?`
      )
      saveFailure(`gen-${fmt}.bin`, bytes, `markers missing: ${missing.join(',')}`)
      markBroken(fmt, 'generator')
    } else {
      generatorValidation.push(`${fmt}: OK (${bytes.length} bytes, markers returned)`)
    }
  }
  generatorValidation.forEach((l) => {
    console.log(`  ${l}`)
  })

  // Phase 2: routine good files (both sources)
  console.log('\n=== PHASE 2: routine good files ===')
  const routineCount = BIG_MODE ? 20 : 200
  for (const fmt of FORMATS) {
    const res: Result = {
      format: fmt.ext,
      source: fmt.source,
      files: 0,
      passed: 0,
      failed: 0,
      hangs: 0,
      skipped: 0,
      slowestMs: 0,
      seed: SEED,
      note: brokenSources.has(`${fmt.ext}:generator`) ? 'generator_broken(phase1)' : '',
      accepted: 0,
      refused: 0
    }
    const n = Math.max(1, Math.floor(routineCount / FORMATS.length))
    for (let i = 0; i < n; i++) {
      const markers = makeMarkers(randInt(1, 3))
      const text = randomText(randInt(50, 5000), markers)
      let bytes: Uint8Array
      let source: Source = fmt.source
      const variantBase = VARIANT_BASE[fmt.ext]
      if (variantBase) {
        // Macro/template variants come from a real generated base, repackaged
        // with the variant's content-type. Never the minimal ooxmlZip() stub.
        const base = await generateWithOffice(variantBase, text, markers)
        if (base) {
          try {
            bytes = repackageVariant(base, fmt.ext)
            source = 'generator'
          } catch {
            bytes = fmt.generate(text, markers)
          }
        } else {
          bytes = fmt.generate(text, markers)
        }
      } else if (GENERATOR_FORMATS.includes(fmt.ext) && rng() < 0.5) {
        const g = await generateWithOffice(fmt.ext, text, markers)
        if (g) {
          bytes = g
          source = 'generator'
        } else {
          bytes = fmt.generate(text, markers)
        }
      } else {
        bytes = fmt.generate(text, markers)
      }

      const key = `${fmt.ext}:${source}`
      if (brokenSources.has(key)) {
        res.skipped++
        res.source = source
        continue
      }
      res.files++
      res.source = source
      const r = await upload(bytes, fmt.ext, mimeForExt(fmt.ext))
      res.slowestMs = Math.max(res.slowestMs, r.ms)
      let failed = false
      if (r.status === 0) {
        res.hangs++
        saveFailure(`hang-${fmt.ext}-${i}.bin`, bytes, 'hang / timeout')
        stopApp()
        await startApp()
        continue
      }
      if (r.status !== 201) {
        failed = true
        res.failed++
        saveFailure(
          `good-${fmt.ext}-${i}.bin`,
          bytes,
          `status ${r.status}: ${r.body.slice(0, 200)}`
        )
      } else {
        const id = (JSON.parse(r.body) as { attachment?: { id?: string } }).attachment?.id
        const out = id ? await getText(id) : ''
        const missing = markers.filter((m) => !out.includes(m))
        if (missing.length > 0) {
          failed = true
          res.failed++
          saveFailure(`good-${fmt.ext}-${i}.bin`, bytes, `markers missing: ${missing.join(',')}`)
        } else {
          res.passed++
        }
      }
      const first = !firstAttempt.has(key)
      firstAttempt.add(key)
      if (failed && first) markBroken(fmt.ext, source, res)
    }
    results.push(res)
  }

  // Phase 3: damaged files
  console.log('\n=== PHASE 3: damaged files ===')
  for (const fmt of FORMATS) {
    const res: Result = {
      format: `${fmt.ext}-damaged`,
      source: fmt.source,
      files: 0,
      passed: 0,
      failed: 0,
      hangs: 0,
      skipped: 0,
      slowestMs: 0,
      seed: SEED,
      note: '',
      accepted: 0,
      refused: 0
    }
    const markers = makeMarkers(1)
    const good = fmt.generate(randomText(500, markers), markers)
    for (const dmg of DAMAGES) {
      const { bytes, extOverride } = damage(good, dmg)
      res.files++
      const r = await upload(bytes, extOverride ?? fmt.ext, mimeForExt(extOverride ?? fmt.ext))
      res.slowestMs = Math.max(res.slowestMs, r.ms)
      // The pass/fail rule lives in a pure module so it can be unit-tested
      // without launching the built app. This loop only gathers the evidence.
      let extractedText = ''
      let storedMimeType: string | null = null
      if (r.status === 201) {
        const attachment = (
          JSON.parse(r.body) as { attachment?: { id?: string; mimeType?: string } }
        ).attachment
        storedMimeType = attachment?.mimeType ?? null
        if (attachment?.id) extractedText = await getText(attachment.id)
      }
      const verdict = evaluateDamage({
        status: r.status,
        body: r.body,
        damage: dmg,
        formatExt: fmt.ext,
        extractedText,
        storedMimeType,
        expectedMime: mimeForExt(VARIANT_BASE[fmt.ext] ?? fmt.ext)
      })
      const pass = verdict.pass
      const reason = verdict.reason
      // Track acceptance separately from pass/fail so the table shows whether
      // the app is quietly accepting more damaged files over time.
      if (r.status === 201) res.accepted++
      else if (r.status >= 400) res.refused++
      if (r.status === 0) res.hangs++
      if (pass) res.passed++
      else {
        res.failed++
        saveFailure(`damaged-${dmg}-${fmt.ext}.bin`, bytes, reason)
      }
      console.log(`  ${fmt.ext}/${dmg}: ${pass ? 'PASS' : 'FAIL'} — ${reason}`)
    }
    results.push(res)
  }

  // Phase 4: real files (optional)
  if (realManifest.length > 0) {
    console.log('\n=== PHASE 4: real files ===')
    for (const rf of realManifest) {
      const bytes = readFileSync(rf.path)
      const res: Result = {
        format: `real:${rf.name}`,
        source: 'real',
        files: 1,
        passed: 0,
        failed: 0,
        hangs: 0,
        skipped: 0,
        slowestMs: 0,
        seed: SEED,
        note: '',
        accepted: 0,
        refused: 0
      }
      const r = await upload(bytes, rf.ext, mimeForExt(rf.ext))
      res.slowestMs = r.ms
      if (rf.expect === 'refuse') {
        // Password-protected and other deliberately unreadable files must be
        // refused with a meaningful message, not accepted as documents.
        const msg = r.body.slice(0, 200)
        const refused = r.status >= 400 && /password|could not be opened|not supported/i.test(msg)
        if (refused) {
          res.passed++
          res.refused++
        } else {
          res.failed++
          saveFailure(`real-${rf.name}`, bytes, `expected refusal, got ${r.status}: ${msg}`)
        }
      } else if (r.status === 201) {
        res.accepted++
        const id = (JSON.parse(r.body) as { attachment?: { id?: string } }).attachment?.id
        const out = id ? await getText(id) : ''
        const missing = rf.words.filter((w) => !out.includes(w))
        if (missing.length === 0) res.passed++
        else {
          res.failed++
          saveFailure(`real-${rf.name}`, bytes, `words missing: ${missing.join(',')}`)
        }
      } else {
        res.failed++
        saveFailure(`real-${rf.name}`, bytes, `status ${r.status}: ${r.body.slice(0, 200)}`)
      }
      results.push(res)
    }
  }

  // Phase 5: big mode
  if (BIG_MODE) {
    console.log('\n=== PHASE 5: big files (near 50MB / 100MB) ===')
    for (const [label, size] of [
      ['under-warning', 40 * 1024 * 1024],
      ['over-warning', 60 * 1024 * 1024],
      ['over-ceiling', 110 * 1024 * 1024]
    ] as const) {
      const bytes = enc('x'.repeat(size))
      const r = await upload(bytes, 'txt', 'text/plain')
      console.log(
        `  ${label} (${(size / 1024 / 1024).toFixed(0)}MB): status ${r.status} ${r.body.slice(0, 120)}`
      )
    }
  }

  stopApp()
  printTable(results)
  rmSync(RUN_ROOT, { recursive: true, force: true })
}

function mimeForExt(ext: string): string {
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    html: 'text/html',
    csv: 'text/csv',
    tex: 'application/x-tex',
    rtf: 'application/rtf',
    epub: 'application/epub+zip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    docm: 'application/vnd.ms-word.document.macroEnabled.12',
    dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
    dotm: 'application/vnd.ms-word.template.macroEnabled.12',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
    potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
    potm: 'application/vnd.ms-powerpoint.template.macroEnabled.12',
    ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
    ppsm: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.12',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
    xltm: 'application/vnd.ms-excel.template.macroEnabled.12',
    odt: 'application/vnd.oasis.opendocument.text',
    odp: 'application/vnd.oasis.opendocument.presentation',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    odg: 'application/vnd.oasis.opendocument.graphics'
  }
  return map[ext] ?? 'application/octet-stream'
}

function loadRealManifest(dir: string): Array<{
  name: string
  path: string
  ext: string
  words: string[]
  expect?: 'refuse'
}> {
  const manifestPath = join('scripts', 'ci', 'random-document-manifest.json')
  if (!existsSync(manifestPath)) return []
  const entries = JSON.parse(readFileSync(manifestPath, 'utf8')) as Array<{
    name: string
    ext: string
    words: string[]
    expect?: 'refuse'
  }>
  return entries
    .filter((e) => existsSync(join(dir, e.name)))
    .map((e) => ({ ...e, path: join(dir, e.name) }))
}

function printTable(results: Result[]) {
  const header = [
    'format',
    'source',
    'files',
    'passed',
    'failed',
    'accepted',
    'refused',
    'hangs',
    'skipped',
    'slowest_ms',
    'seed',
    'note'
  ]
  const rows = results.map((r) => [
    r.format,
    r.source,
    String(r.files),
    String(r.passed),
    String(r.failed),
    String(r.accepted),
    String(r.refused),
    String(r.hangs),
    String(r.skipped),
    String(Math.round(r.slowestMs)),
    String(r.seed),
    r.note
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join(' | ')
  const out = [line(header), widths.map((w) => '-'.repeat(w)).join('-+-'), ...rows.map(line)].join(
    '\n'
  )
  console.log(`\n${out}`)
  const outFile = join(FAILURE_DIR, `report-${SEED}.txt`)
  writeFileSync(outFile, `${out}\n`)
  console.log(`\nReport saved to ${outFile}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
