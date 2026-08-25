import { redo, undo } from '@codemirror/commands'
import { foldAll, unfoldAll } from '@codemirror/language'
import { openSearchPanel } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'
import { ActionIcon, Divider, Tooltip } from '@mantine/core'
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowsDiagonal,
  IconArrowsMinimize,
  IconDeviceFloppy,
  IconReplace,
  IconSearch,
  IconTextWrap
} from '@tabler/icons-react'
import type { JSX } from 'react'
import { UI_TEXT } from '../../config/index.js'

/**
 * IDE-style source toolbar for the HTML/CSS/JavaScript subfile editors.
 * Every action dispatches through the live CodeMirror view, so formatting,
 * undo/redo and search participate in the ordinary draft → autosave flow and
 * can never reset or bypass the generation-guarded draft contract.
 */

export interface SourceToolbarProps {
  getView: () => EditorView | null
  /** Formats the document with the lazily loaded Prettier standalone build. */
  onFormat: () => void
  wordWrap: boolean
  onToggleWordWrap: () => void
  fontSize: number
  onFontSizeChange: (size: number) => void
  fullscreen: boolean
  onToggleFullscreen: () => void
  onReturnToPreview: () => void
  onSaveNow: () => void
}

const FONT_MIN = 10
const FONT_MAX = 24
const FONT_STEP = 1

export function SourceToolbar(props: SourceToolbarProps): JSX.Element {
  const withView = (action: (view: EditorView) => void) => (): void => {
    const view = props.getView()
    if (view) action(view)
  }

  return (
    <div
      className="ide-toolbar"
      role="toolbar"
      aria-label={UI_TEXT.ideToolbarLabel}
      data-testid="source-toolbar"
    >
      <Tooltip label={UI_TEXT.undoLabel}>
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.undoLabel}
          onClick={withView((view) => undo(view))}
        >
          <IconArrowBackUp size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.redoLabel}>
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.redoLabel}
          onClick={withView((view) => redo(view))}
        >
          <IconArrowForwardUp size={16} />
        </ActionIcon>
      </Tooltip>

      <Divider orientation="vertical" mx={4} />

      <Tooltip label={`${UI_TEXT.ideFindLabel} (Ctrl+F)`}>
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.ideFindLabel}
          data-testid="ide-find"
          onClick={withView((view) => openSearchPanel(view))}
        >
          <IconSearch size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={`${UI_TEXT.ideReplaceLabel} (Ctrl+H)`}>
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.ideReplaceLabel}
          data-testid="ide-replace"
          onClick={withView((view) => openSearchPanel(view))}
        >
          <IconReplace size={16} />
        </ActionIcon>
      </Tooltip>

      <Divider orientation="vertical" mx={4} />

      <Tooltip label={`${UI_TEXT.ideFormatLabel} (Shift+Alt+F)`}>
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.ideFormatLabel}
          data-testid="ide-format"
          onClick={props.onFormat}
        >
          <span aria-hidden="true" style={{ fontSize: 11, fontWeight: 700 }}>
            F
          </span>
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.ideWordWrapLabel}>
        <ActionIcon
          variant={props.wordWrap ? 'light' : 'subtle'}
          color={props.wordWrap ? 'blue' : undefined}
          aria-label={UI_TEXT.ideWordWrapLabel}
          aria-pressed={props.wordWrap}
          data-testid="ide-word-wrap"
          onClick={props.onToggleWordWrap}
        >
          <IconTextWrap size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.ideFoldAllLabel}>
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.ideFoldAllLabel}
          data-testid="ide-fold-all"
          onClick={withView((view) => foldAll(view))}
        >
          <span aria-hidden="true" style={{ fontSize: 10, fontWeight: 700 }}>
            −×
          </span>
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.ideUnfoldAllLabel}>
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.ideUnfoldAllLabel}
          data-testid="ide-unfold-all"
          onClick={withView((view) => unfoldAll(view))}
        >
          <span aria-hidden="true" style={{ fontSize: 10, fontWeight: 700 }}>
            +×
          </span>
        </ActionIcon>
      </Tooltip>

      <Divider orientation="vertical" mx={4} />

      <Tooltip label={UI_TEXT.ideFontSmallerLabel}>
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.ideFontSmallerLabel}
          data-testid="ide-font-decrease"
          disabled={props.fontSize <= FONT_MIN}
          onClick={() => props.onFontSizeChange(Math.max(FONT_MIN, props.fontSize - FONT_STEP))}
        >
          <span aria-hidden="true" style={{ fontSize: 10, fontWeight: 700 }}>
            A−
          </span>
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.ideFontResetLabel}>
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.ideFontResetLabel}
          data-testid="ide-font-reset"
          onClick={() => props.onFontSizeChange(14)}
        >
          <span aria-hidden="true" style={{ fontSize: 11, fontWeight: 700 }}>
            A
          </span>
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.ideFontLargerLabel}>
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.ideFontLargerLabel}
          data-testid="ide-font-increase"
          disabled={props.fontSize >= FONT_MAX}
          onClick={() => props.onFontSizeChange(Math.min(FONT_MAX, props.fontSize + FONT_STEP))}
        >
          <span aria-hidden="true" style={{ fontSize: 13, fontWeight: 700 }}>
            A+
          </span>
        </ActionIcon>
      </Tooltip>

      <Divider orientation="vertical" mx={4} />

      <Tooltip label={`${UI_TEXT.ideSaveNowLabel} (Ctrl+S)`}>
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.ideSaveNowLabel}
          data-testid="ide-save-now"
          onClick={props.onSaveNow}
        >
          <IconDeviceFloppy size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip
        label={
          props.fullscreen ? UI_TEXT.workspaceExitFullscreenLabel : UI_TEXT.workspaceFullscreenLabel
        }
      >
        <ActionIcon
          variant="subtle"
          aria-label={
            props.fullscreen
              ? UI_TEXT.workspaceExitFullscreenLabel
              : UI_TEXT.workspaceFullscreenLabel
          }
          data-testid="ide-fullscreen"
          onClick={props.onToggleFullscreen}
        >
          {props.fullscreen ? <IconArrowsMinimize size={16} /> : <IconArrowsDiagonal size={16} />}
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.htmlSourceBackToPreview}>
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.htmlSourceBackToPreview}
          data-testid="return-to-preview"
          onClick={props.onReturnToPreview}
        >
          <span aria-hidden="true" style={{ fontSize: 11, fontWeight: 700 }}>
            ◀
          </span>
        </ActionIcon>
      </Tooltip>
    </div>
  )
}
