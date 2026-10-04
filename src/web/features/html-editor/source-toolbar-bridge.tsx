import { ActionIcon } from '@mantine/core'
import { IconArrowLeft } from '@tabler/icons-react'
import type { ReactNode } from 'react'

import { UI_TEXT } from '../../config/index.js'
import { DocumentToolbar } from '../workspace/document-toolbar.js'
import { createSourceCapabilities, type SourceToolbarActions } from './source-capabilities.js'

/**
 * The bridge from the source editor to the unified toolbar.
 *
 * ## Why this file exists
 *
 * The same reason `rich-toolbar-bridge.tsx` does. `createSourceCapabilities` is a
 * plain function, so it needs no hook of its own; but something has to hold the
 * editor actions, call it, and render the shared shell. That is this.
 *
 * ## Why the trigger is the shell's
 *
 * `source-toolbar.tsx` drew its own `ActionIcon`s, its own tooltips and its own
 * `role="toolbar"` inside the app toolbar row — two nested toolbars on one HTML
 * page, with two focus models and two divider systems. This component draws no
 * control at all except the one action that genuinely is not a formatting command:
 * leaving source mode, which is a view switch and belongs in the row's `trailing`
 * slot, exactly where the Markdown page puts its Edit/Preview control.
 */
export type SourceToolbarBridgeProps = SourceToolbarActions & {
  /**
   * Leaves source mode. Rendered at the end of the row, not as a command.
   *
   * Optional because the rendered preview has nowhere to return from — it is
   * already the preview. Passing it there would put a back-arrow on a page that
   * is not behind anything.
   */
  onReturnToPreview?: () => void
  /**
   * Anything else this view owns that is not a formatting command.
   *
   * The JavaScript gate lives here: it is a view-level switch like the Markdown
   * page's Edit/Preview control, not a document command, and it belongs in the
   * row's trailing slot rather than in a strip of its own beside the editor.
   */
  trailing?: ReactNode
}

export function SourceToolbarBridge({
  onReturnToPreview,
  trailing,
  ...actions
}: SourceToolbarBridgeProps): React.ReactElement {
  /*
   * Built on every render, deliberately.
   *
   * The shell reads `state()` on every render rather than memoising it, because a
   * surface's `state()` is a reader over live editor state, not a value. A record
   * frozen on the first render would leave every pressed indicator stale — measured
   * on the Rich Note, where that bug survived because Markdown-only tests passed.
   *
   * So a fresh record per render is the correct shape here, and `useMemo` would only
   * reintroduce the bug it looks like it prevents. The record is cheap: a dozen
   * closures over props the owner already holds.
   */
  /*
   * No `withDocumentControlsUnavailable` here, and that is a correction.
   *
   * The first version wrapped the record so that every document capability —
   * bold, headings, callouts, 30 of them — reported "not available in a source
   * editor" and therefore rendered **greyed** rather than being dropped.
   *
   * The resolver's rule is `if (!run && !menu && !stated) continue`: a capability
   * with no command *and* no stated reason is dropped. Stating a reason for a
   * capability the surface has no command for overrides that, and the effect was a
   * row of about 46 controls in which roughly 30 could never do anything. Every one
   * of the 14 controls the HTML page actually has was pushed into the overflow
   * panel, so reaching Find or Comment meant opening "More" first.
   *
   * Measured: `ide-fullscreen` could not be clicked at all, because it was inside
   * the overflow panel and nothing had opened it.
   *
   * The rule is right as written. A control with no command is not an unavailable
   * control, it is a control this surface does not have, and the honest rendering is
   * to leave it out. Greyed-with-a-reason is for a command that exists and cannot act
   * *now* — which is exactly what the font-size bounds and the history depth do
   * report.
   */
  const capabilities = createSourceCapabilities(actions)

  return (
    <DocumentToolbar
      capabilities={capabilities}
      // The id this row was called before it joined the shared shell, kept because
      // the HTML page's existing spec addresses it by that name.
      testId="source-toolbar"
      trailing={
        <>
          {onReturnToPreview ? (
            <ActionIcon
              variant="subtle"
              aria-label={UI_TEXT.htmlSourceBackToPreview}
              // The id the old control carried and `code-ide.pwspec.ts` asserts. The
              // control moved; the test surface did not.
              data-testid="return-to-preview"
              onClick={onReturnToPreview}
            >
              <IconArrowLeft size={16} />
            </ActionIcon>
          ) : null}
          {trailing}
        </>
      }
    />
  )
}

/** Re-exported so a caller does not need the adapter's types for the props. */
export type { SourceToolbarActions }
