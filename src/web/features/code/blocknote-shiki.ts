/**
 * Hands RTWiki's Shiki instance to BlockNote, so the Rich Editor's code blocks and
 * the Markdown preview's code fences are highlighted by the same engine.
 *
 * ## Why this is a thin adapter and not a second integration
 *
 * The audit found BlockNote **already** has the integration, but that it is
 * **opt-in and off by default**. `@blocknote/core/extensions` exports
 * `SyntaxHighlightingExtension`, and its own documentation states it plainly:
 *
 * > Highlighting is opt-in: the user adds this extension to the editor's
 * > `extensions` (configured with a `createHighlighter`) to enable it. When it's
 * > absent, content renders as plain text.
 *
 * RTWiki added no such extension, so code blocks in the Rich Editor were plain
 * text. That is the whole reason this file exists — the capability was present and
 * unused, not missing.
 *
 * ## Why one engine, not two
 *
 * The callback returns the **same** `HighlighterCore` instance
 * ({@link getHighlighter}) that the Markdown path calls `codeToHtml` on. So both
 * surfaces share one set of parsed grammars, one theme pair, and one alias table
 * (`code-registry.ts`). Two `createHighlighter` calls would mean two grammar sets
 * in memory and, worse, the possibility that the same fence renders differently in
 * the two surfaces — which is the specific outcome §7 and §10 of the task forbid.
 *
 * ## Why the callback is created, not exported
 *
 * `useCreateBlockNote` is memoised for the life of the page, so the value passed
 * into `extensions` must keep a stable identity across renders. A factory gives
 * the call site something to memoise; a module-level constant would hide that
 * requirement from whoever edits the call next.
 */
import { SyntaxHighlightingExtension } from '@blocknote/core/extensions'
import type { HighlighterGeneric } from '@shikijs/types'
import { getHighlighter } from './shiki-service.js'

/**
 * The BlockNote extension that turns on syntax highlighting, wired to RTWiki's
 * engine.
 *
 * Called once per editor instance and its result passed to `useCreateBlockNote`'s
 * `extensions`. The returned value is not itself stateful in a way RTWiki manages;
 * BlockNote owns the plugin's lifetime.
 */
export function createSyntaxHighlightingExtension() {
  return SyntaxHighlightingExtension({
    /**
     * BlockNote calls this lazily — only when a node in the schema actually
     * declares it should be highlighted. So a Rich Note with no code block never
     * builds the highlighter, which is the behaviour that keeps Shiki out of the
     * initial bundle even for editor users.
     *
     * The return type is widened to `HighlighterGeneric` because BlockNote's option
     * type asks for the generic form. Its two type parameters are Shiki's
     * `BundledLanguage` and `BundledTheme`, which are string-literal unions that
     * exist **only** for `shiki/bundle` — the all-languages entry this project
     * deliberately does not use. RTWiki's fine-grained highlighter loads grammars by
     * dynamic import and carries no such union, so `never` is the accurate argument:
     * it says "this highlighter is not typed against a bundled grammar list", which is
     * true. `any` would also satisfy the signature but disables type checking for
     * every value that flows through it, and the lint rule rightly rejects it.
     */
    createHighlighter: () =>
      getHighlighter() as unknown as Promise<HighlighterGeneric<never, never>>
  })
}
