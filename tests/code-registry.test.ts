import { describe, expect, it } from 'bun:test'
import {
  CODE_LANGUAGES,
  CODE_THEMES,
  codeLanguageAliases,
  findCodeLanguage,
  isCodeColorScheme,
  resolveCodeLanguage
} from '../src/web/features/code/code-registry.js'

describe('code registry: aliases', () => {
  it('resolves every alias the task named', () => {
    expect(resolveCodeLanguage('js')).toBe('javascript')
    expect(resolveCodeLanguage('jsx')).toBe('javascript')
    expect(resolveCodeLanguage('ts')).toBe('typescript')
    expect(resolveCodeLanguage('tsx')).toBe('typescript')
    expect(resolveCodeLanguage('sh')).toBe('bash')
    expect(resolveCodeLanguage('shell')).toBe('bash')
    expect(resolveCodeLanguage('yml')).toBe('yaml')
    expect(resolveCodeLanguage('md')).toBe('markdown')
  })

  it('is case-insensitive, because an author writing ```JS is not an error', () => {
    expect(resolveCodeLanguage('JS')).toBe('javascript')
    expect(resolveCodeLanguage('TypeScript')).toBe('typescript')
    expect(resolveCodeLanguage('PYTHON')).toBe('python')
  })

  it('takes only the first word of a fence info', () => {
    expect(resolveCodeLanguage('js title="app.js"')).toBe('javascript')
    expect(resolveCodeLanguage('ts{1,3}')).toBeUndefined()
    expect(resolveCodeLanguage('python linenos')).toBe('python')
  })

  it('returns undefined for unknown and absent languages, so callers fall back', () => {
    expect(resolveCodeLanguage('rust')).toBeUndefined()
    expect(resolveCodeLanguage('brainfuck')).toBeUndefined()
    expect(resolveCodeLanguage('')).toBeUndefined()
    expect(resolveCodeLanguage(null)).toBeUndefined()
    expect(resolveCodeLanguage(undefined)).toBeUndefined()
    expect(resolveCodeLanguage('   ')).toBeUndefined()
  })
})

describe('code registry: invariants', () => {
  it('has no duplicate ids', () => {
    const ids = CODE_LANGUAGES.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has no duplicate aliases across languages', () => {
    const owner = new Map<string, string>()
    for (const lang of CODE_LANGUAGES) {
      for (const alias of lang.aliases) {
        const claimed = owner.get(alias)
        expect(claimed === undefined || claimed === lang.id).toBe(true)
        owner.set(alias, lang.id)
      }
    }
  })

  it('includes each language own id among its aliases, so ids resolve', () => {
    for (const lang of CODE_LANGUAGES) {
      expect(lang.aliases).toContain(lang.id)
    }
  })

  it('gives every language a loader, or an entry is dead configuration', () => {
    for (const lang of CODE_LANGUAGES) {
      expect(typeof lang.loader).toBe('function')
      expect(typeof lang.loader()).toBe('object')
    }
  })

  it('exposes every alias it claims', () => {
    const all = codeLanguageAliases()
    for (const lang of CODE_LANGUAGES) {
      for (const alias of lang.aliases) {
        expect(all).toContain(alias)
      }
    }
  })

  it('findCodeLanguage round-trips every id', () => {
    for (const lang of CODE_LANGUAGES) {
      expect(findCodeLanguage(lang.id)?.id).toBe(lang.id)
    }
    expect(findCodeLanguage('nope')).toBeUndefined()
  })
})

describe('code themes', () => {
  it('exposes exactly one light and one dark theme', () => {
    expect(Object.keys(CODE_THEMES).sort()).toEqual(['dark', 'light'])
  })

  it('gives both themes a distinct id and a loader', () => {
    expect(CODE_THEMES.light.id).not.toBe(CODE_THEMES.dark.id)
    expect(typeof CODE_THEMES.light.loader).toBe('function')
    expect(typeof CODE_THEMES.dark.loader).toBe('function')
  })

  it('guards the colour scheme, so a typo cannot reach Shiki', () => {
    expect(isCodeColorScheme('light')).toBe(true)
    expect(isCodeColorScheme('dark')).toBe(true)
    expect(isCodeColorScheme('solarized')).toBe(false)
    expect(isCodeColorScheme(undefined)).toBe(false)
    expect(isCodeColorScheme(null)).toBe(false)
    expect(isCodeColorScheme(1)).toBe(false)
  })
})
