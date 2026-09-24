/**
 * Validates that an .ico file uses DIB/BMP image entries rather than
 * PNG-compressed ones.
 *
 * Why this exists: Windows RC.EXE (used by tauri-winres to embed the
 * executable icon) rejects PNG-compressed ICO entries with RC2176
 * ("old DIB in icon.ico"). Hand-rolled ICO writers that store PNG bytes
 * therefore produce an icon the Windows resource compiler refuses, even
 * though many image viewers accept it. Every entry must start with a
 * BITMAPINFOHEADER (biSize == 40).
 *
 * Usage: bun scripts/validate-ico.ts [path]
 * Exits 0 when valid, 1 when invalid.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BITMAPINFOHEADER_SIZE = 40
const ICO_TYPE = 1

const target = resolve(process.argv[2] ?? 'src-tauri/icons/icon.ico')
const buf = readFileSync(target)

function fail(message: string): never {
  console.error(`INVALID ICO: ${target}\n  ${message}`)
  process.exit(1)
}

// ICONDIR: reserved (0), type (1 = icon), image count.
if (buf.readUInt16LE(0) !== 0) {
  fail(`reserved field must be 0, found ${buf.readUInt16LE(0)}`)
}
if (buf.readUInt16LE(2) !== ICO_TYPE) {
  fail(`type field must be 1 (icon), found ${buf.readUInt16LE(2)}`)
}

const count = buf.readUInt16LE(4)
if (count === 0) {
  fail('no image entries')
}

const seen = new Set<string>()
for (let i = 0; i < count; i++) {
  const entry = 6 + i * 16
  if (entry + 16 > buf.length) {
    fail(`entry ${i} runs past end of file`)
  }
  const width = buf[entry] === 0 ? 256 : buf.readUInt8(entry)
  const height = buf[entry + 1] === 0 ? 256 : buf.readUInt8(entry + 1)
  const planes = buf.readUInt16LE(entry + 4)
  const bitCount = buf.readUInt16LE(entry + 6)
  const bytes = buf.readUInt32LE(entry + 8)
  const offset = buf.readUInt32LE(entry + 12)
  const label = `${width}x${height}`
  seen.add(label)

  if (bytes === 0) {
    fail(`${label} has zero length`)
  }
  if (offset + 40 > buf.length) {
    fail(`${label} data offset is out of bounds`)
  }
  if (buf[offset] === 0x89 && buf[offset + 1] === 0x50) {
    // PNG-compressed entry. RC.EXE decides how to interpret an entry from
    // biPlanes: a non-zero value means "DIB icon", so the compiler parses
    // the PNG bytes as a DIB and fails with RC2176 ("old DIB"). PNG
    // entries must therefore declare planes = 0.
    if (planes !== 0) {
      fail(
        `${label} is PNG-compressed but declares planes=${planes}; ` +
          'PNG entries must declare planes=0 or RC.EXE reports RC2176'
      )
    }
    console.log(`  ok ${label.padEnd(9)} png    planes=${planes} bits=${bitCount} bytes=${bytes}`)
    continue
  }

  const headerSize = buf.readUInt32LE(offset)
  if (headerSize !== BITMAPINFOHEADER_SIZE) {
    fail(`${label} starts with a ${headerSize}-byte header, expected BITMAPINFOHEADER (40)`)
  }
  if (planes !== 1) {
    fail(`${label} is DIB but declares planes=${planes}, expected 1`)
  }
  console.log(`  ok ${label.padEnd(9)} dib    planes=${planes} bits=${bitCount} bytes=${bytes}`)
}

for (const required of ['16x16', '32x32', '256x256']) {
  if (!seen.has(required)) {
    fail(`missing required size ${required}`)
  }
}

console.log(`VALID ICO: ${target} (${count} DIB entries)`)
