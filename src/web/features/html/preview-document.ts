import { CHANNEL_ID_PATTERN } from './preview-messages.js'

/**
 * Secure preview-document builder.
 *
 * Assembles the `srcdoc` payload for the sandboxed preview iframe:
 *
 * - The Content-Security-Policy meta is emitted BEFORE any user content and
 *   enforces the Phase 4A directive set. The script nonce is the parent
 *   document's per-response nonce (authorized Option A): srcdoc frames
 *   inherit the parent CSP, so both policies must allow the same scripts.
 * - Only the JavaScript pane is executable, via a nonce'd script element.
 *   No eval, no new Function, no unsafe-eval, no script unsafe-inline.
 * - Closing `</script` / `</style` sequences in user content are escaped
 *   case-insensitively so authored text can never terminate its container
 *   early or inject markup into the document skeleton.
 */

export interface PreviewDocumentInput {
  /** Normalized HTML (see normalize-html.ts) — never the raw stored source. */
  normalizedHead: string
  normalizedBody: string
  css: string
  javascript: string
  /** Per-response parent CSP nonce (base64). */
  nonce: string
  /** Per-preview channel ID (32 hex chars). */
  channelId: string
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Escapes closing-sequence breakouts inside <style> content. */
export function escapeStyleContent(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style')
}

/**
 * Escapes closing-sequence breakouts inside <script> content. `<\/script`
 * is semantically identical to `</script` inside JavaScript strings and
 * regexes, so user code behavior is preserved.
 */
export function escapeScriptContent(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script')
}

/**
 * The child policy is stricter than the inherited parent policy; multiple
 * CSPs intersect, so effective enforcement is at least this strict.
 * img-src stays data:-only for Phase 4A (no blob:, per owner decision).
 */
export function buildPreviewCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "script-src-attr 'none'",
    "style-src 'unsafe-inline'",
    'img-src data:',
    "connect-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

/**
 * In-frame bootstrap: defense-in-depth navigation/form prevention plus
 * sanitized error reporting to the parent through the approved channel.
 * Injected as a literal with only the channel ID substituted (validated
 * hex), so it can introduce no injection surface of its own.
 */
const BOOTSTRAP_SCRIPT = [
  '(function () {',
  "  'use strict';",
  "  var CHANNEL = '__CHANNEL_ID__';",
  '  function post(message) {',
  "    try { parent.postMessage(message, '*'); } catch (e) { /* opaque-origin messaging is best-effort */ }",
  '  }',
  "  window.addEventListener('error', function (event) {",
  "    post({ type: 'rtwiki-preview-error', channel: CHANNEL, operation: 'runtime',",
  "      errorName: (event.error && event.error.name) || 'Error' });",
  '  });',
  "  window.addEventListener('unhandledrejection', function (event) {",
  '    var reason = event.reason;',
  "    post({ type: 'rtwiki-preview-error', channel: CHANNEL, operation: 'promise',",
  "      errorName: (reason && reason.name) || 'Error' });",
  '  });',
  "  document.addEventListener('click', function (event) {",
  '    var target = event.target;',
  "    var anchor = target && target.closest ? target.closest('a') : null;",
  '    if (anchor) {',
  '      event.preventDefault();',
  "      post({ type: 'rtwiki-preview-error', channel: CHANNEL, operation: 'anchor-navigation' });",
  '    }',
  '  }, true);',
  "  document.addEventListener('submit', function (event) {",
  '    event.preventDefault();',
  "    post({ type: 'rtwiki-preview-error', channel: CHANNEL, operation: 'form-submission' });",
  '  }, true);',
  "  post({ type: 'rtwiki-preview-ready', channel: CHANNEL });",
  '})();'
].join('\n')

export class PreviewBuildError extends Error {}

/**
 * Builds the complete srcdoc string. Throws PreviewBuildError on invalid
 * inputs (bad nonce/channel) — callers must render recoverable UI.
 */
export function buildPreviewDocument(input: PreviewDocumentInput): string {
  const { nonce, channelId } = input
  if (!/^[A-Za-z0-9+/=]+$/.test(nonce)) {
    throw new PreviewBuildError('Invalid preview nonce')
  }
  if (!CHANNEL_ID_PATTERN.test(channelId)) {
    throw new PreviewBuildError('Invalid preview channel id')
  }

  const csp = buildPreviewCsp(nonce)
  const bootstrap = BOOTSTRAP_SCRIPT.replace('__CHANNEL_ID__', channelId)

  const styleBlock =
    input.css.trim().length > 0 ? `<style>\n${escapeStyleContent(input.css)}\n</style>` : ''

  const scriptBlock =
    input.javascript.trim().length > 0
      ? `<script nonce="${escapeHtmlAttribute(nonce)}">\n${escapeScriptContent(
          input.javascript
        )}\n</script>`
      : ''

  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}">`,
    input.normalizedHead,
    styleBlock,
    '</head>',
    '<body>',
    input.normalizedBody,
    `<script nonce="${escapeHtmlAttribute(nonce)}">\n${bootstrap}\n</script>`,
    scriptBlock,
    '</body>',
    '</html>'
  ].join('\n')
}
