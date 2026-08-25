import type { Plugin } from 'prettier'
import type { CodeEditorLanguage } from './use-codemirror.js'

/**
 * Document formatting through Prettier's standalone browser build.
 *
 * The formatter (and its per-language plugins) is imported lazily here so it
 * is only downloaded when Format Document is first invoked — never part of
 * the initial bundle. Formatting is total: any failure resolves to a
 * contained error result, and an empty output can never replace the source.
 */

export type FormatResult = { ok: true; formatted: string } | { ok: false; error: string }

async function loadPlugins(language: CodeEditorLanguage): Promise<Plugin[]> {
  switch (language) {
    case 'html':
      return [await import('prettier/plugins/html')]
    case 'css':
      return [await import('prettier/plugins/postcss')]
    case 'javascript': {
      // Babel parses; estree prints. Both are required for JavaScript.
      const babel = await import('prettier/plugins/babel')
      const estree = (await import('prettier/plugins/estree')).default as unknown as Plugin
      return [babel, estree]
    }
  }
}

function parserFor(language: CodeEditorLanguage): string {
  return language === 'javascript' ? 'babel' : language
}

export async function formatSource(
  language: CodeEditorLanguage,
  source: string
): Promise<FormatResult> {
  try {
    const prettier = await import('prettier/standalone')
    const plugins = await loadPlugins(language)
    const formatted = await prettier.format(source, {
      parser: parserFor(language),
      plugins,
      // Stable, conservative settings shared by all three languages.
      printWidth: 100,
      tabWidth: 2,
      semi: true,
      singleQuote: false
    })
    if (!formatted.trim()) {
      // Never replace source with an empty result.
      return { ok: false, error: 'Formatter produced an empty document.' }
    }
    return { ok: true, formatted }
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0] : String(err)
    return { ok: false, error: message.slice(0, 200) }
  }
}
