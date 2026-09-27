import { inspectImageUpload, pixelCount } from '../src/server/attachments/image-detect.js'

// The portable executable must be able to detect images with no Node, no Bun and
// no runtime installed. This is the check that a bundler-only test cannot make.
const text = (s: string) => new TextEncoder().encode(s)

const REAL_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
)

const checks: Array<[string, Promise<unknown>, boolean]> = [
  ['real PNG accepted', inspectImageUpload(REAL_PNG).then((r) => r.ok), true],
  [
    'SVG refused with the specific reason',
    inspectImageUpload(
      text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    ).then((r) => !r.ok && r.reason === 'svg_not_supported'),
    true
  ],
  [
    'PNG signature + script refused',
    inspectImageUpload(
      new Uint8Array([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
        ...text('<script>alert(1)</script>')
      ])
    ).then((r) => !r.ok),
    true
  ],
  [
    'HTML refused',
    inspectImageUpload(text('<html><script>alert(1)</script></html>')).then((r) => !r.ok),
    true
  ],
  ['pixel count works', Promise.resolve(pixelCount(4000, 3000) === 12_000_000), true]
]

let failures = 0
for (const [name, promise, want] of checks) {
  let got: unknown
  try {
    got = await promise
  } catch (e) {
    got = `THREW: ${(e as Error).message}`
  }
  const ok = got === want
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}

console.log(
  failures === 0
    ? '\nALL PASS - detection works in the compiled executable'
    : `\n${failures} FAILED`
)
process.exit(failures === 0 ? 0 : 1)
