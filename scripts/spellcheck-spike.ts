/**
 * Spell-check spike: prove nspell can check text with the vendored dictionary
 * before any UI is written. Run with: bun run scripts/spellcheck-spike.ts
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const nspellModule = require('nspell')
const nspell = nspellModule.default ?? nspellModule

const aff = readFileSync('public/dict/en.aff', 'utf8')
const dic = readFileSync('public/dict/en.dic', 'utf8')
const spell = nspell(aff, dic)

const cases: [string, boolean][] = [
  ['hello', true],
  ['teh', false],
  ['diagram', true],
  ['mermaid', true],
  ['Mitochondria', true],
  ['recieve', false],
  ['wonderfull', false],
  ['running', true],
  ['runs', true],
  ['studies', true]
]

let failures = 0
for (const [word, expected] of cases) {
  const actual = spell.correct(word)
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${word.padEnd(16)} correct=${String(actual).padEnd(5)} expected=${expected}`
  )
}

console.log(`  suggestions for "teh": ${JSON.stringify(spell.suggest('teh').slice(0, 3))}`)

// The custom dictionary is the whole reason for not using the browser's own
// spell checker: browsers refuse to let JavaScript add words to it.
spell.dictionary('Osmosis nephron polymerase Zymurgy')
for (const word of ['Osmosis', 'nephron', 'polymerase', 'Zymurgy']) {
  const ok = spell.correct(word)
  if (!ok) failures += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} custom word ${word} -> ${ok}`)
}

console.log(failures === 0 ? 'SPIKE PASS' : `SPIKE FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
