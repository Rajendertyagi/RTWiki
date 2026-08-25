import type { BlockNoteEditor } from '@blocknote/core'
import {
  ActionIcon,
  Button,
  Group,
  Select,
  Text,
  Textarea,
  Tooltip,
  useComputedColorScheme
} from '@mantine/core'
import { PREVIEW_REBUILD_DEBOUNCE_MS } from '@rtwiki/shared/constants'
import {
  IconAspectRatio,
  IconPencil,
  IconPlayerPlay,
  IconRefresh,
  IconZoomIn,
  IconZoomOut
} from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { LAYOUT, UI_TEXT } from '../../../config/index.js'
import { debugLog, safeHash } from '../../../diagnostics/debug-log.js'
import { DIAGRAM_TEMPLATES } from '../insert-blocks.js'
import { ResizableBlockContainer } from './block-resize.js'
import classes from './mermaid-block.module.css'
import { renderMermaidSvg } from './mermaid-render.js'

/**
 * Shared preview-first view for Mermaid-backed blocks (Diagram, Mind Map).
 *
 * Normal view: the rendered (sanitized) SVG only, with a compact toolbar
 * (Edit, Fit/Actual, and zoom for Mind Map). Edit view: a source editor on
 * the left and a LIVE rendered preview on the right — typing re-renders the
 * preview without requiring Apply. Apply commits the source through the editor
 * (so autosave sees an ordinary document change) and exits edit mode; Cancel
 * restores the last applied source. Render failures stay contained to the
 * preview column and never hide the source being edited.
 */

export interface MermaidBlockViewProps {
  blockId: string
  /** The block's current plain-text Mermaid source. */
  source: string
  blockType: 'diagram' | 'mindMap'
  editor: BlockNoteEditor
  /**
   * ProseMirror content binding for the plain-text source. Must stay mounted
   * in EVERY state (preview/editing/error) or the node view cannot attach
   * the document text; it is kept visually hidden because the rendered
   * diagram replaces the raw source in the user interface.
   */
  contentRef: (node: HTMLElement | null) => void
  /** Stored container width prop (px string, '' = auto). */
  width?: string
  /** Stored container height prop (px string, '' = auto). */
  height?: string
  /** Persists new container dimensions without disturbing other props. */
  onCommitSize?: (width: string, height: string) => void
}

type RenderErrorCode = 'parse_error' | 'render_error'

const ERROR_MESSAGES: Record<RenderErrorCode, string> = {
  parse_error: UI_TEXT.diagramErrorTitle,
  render_error: UI_TEXT.diagramErrorTitle
}

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2
const ZOOM_STEP = 0.25

export function MermaidBlockView({
  blockId,
  source,
  blockType,
  editor,
  contentRef,
  width = '',
  height = '',
  onCommitSize
}: MermaidBlockViewProps): JSX.Element {
  const colorScheme = useComputedColorScheme('light')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(source)
  const [committedSvg, setCommittedSvg] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<RenderErrorCode | null>(null)
  const [renderSeq, setRenderSeq] = useState(0)
  const [liveSvg, setLiveSvg] = useState<string | null>(null)
  const [liveError, setLiveError] = useState<RenderErrorCode | null>(null)
  const [debouncedDraft, setDebouncedDraft] = useState(source)
  const [fit, setFit] = useState(true)
  const [zoom, setZoom] = useState(1)

  // Generation tokens: an older async render can never overwrite a newer
  // preview. Each render increments its own token; on resolution we apply the
  // result only when its token is still the latest requested.
  const committedGenRef = useRef(0)
  const liveGenRef = useRef(0)
  const latestSourceRef = useRef(source)
  latestSourceRef.current = source

  // Committed preview (normal view) — re-renders on source/theme/retry.
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderSeq is the manual Retry trigger and is intentionally not read inside the effect
  useEffect(() => {
    const gen = ++committedGenRef.current
    setErrorCode(null)
    void renderMermaidSvg(source, {
      theme: colorScheme === 'dark' ? 'dark' : 'default',
      blockId,
      blockType
    }).then((result) => {
      if (gen !== committedGenRef.current) return
      if (result.ok) {
        setCommittedSvg(result.svg)
      } else {
        setCommittedSvg(null)
        setErrorCode(result.code)
      }
    })
  }, [source, colorScheme, renderSeq, blockId, blockType])

  // Debounce the live draft so typing never re-renders per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedDraft(draft), PREVIEW_REBUILD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft])

  // Live preview (edit view) — re-renders on debounced draft/theme/retry.
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderSeq is the manual Retry trigger and is intentionally not read inside the effect
  useEffect(() => {
    const gen = ++liveGenRef.current
    setLiveError(null)
    void renderMermaidSvg(debouncedDraft, {
      theme: colorScheme === 'dark' ? 'dark' : 'default',
      blockId,
      blockType
    }).then((result) => {
      if (gen !== liveGenRef.current) return
      if (result.ok) {
        setLiveSvg(result.svg)
      } else {
        setLiveSvg(null)
        setLiveError(result.code)
      }
    })
  }, [debouncedDraft, colorScheme, renderSeq, blockId, blockType])

  const startEditing = (): void => {
    setDraft(source)
    setEditing(true)
    debugLog('ui', 'ui_context_menu_action', { targetId: blockId, code: `${blockType}-edit` })
  }

  const apply = (): void => {
    setEditing(false)
    if (draft !== source) {
      editor.updateBlock({ id: blockId } as never, { content: draft } as never)
    }
    debugLog('ui', 'ui_context_menu_action', {
      targetId: blockId,
      code: `${blockType}-apply`,
      len: draft.length,
      hash: safeHash(draft)
    })
  }

  const cancel = (): void => {
    setDraft(source)
    setEditing(false)
  }

  const zoomControls = (
    <Group gap={2} wrap="nowrap" className={classes.zoomControls}>
      <ActionIcon
        size="xs"
        variant="subtle"
        aria-label="Zoom out"
        disabled={zoom <= ZOOM_MIN}
        data-testid={`${blockType}-zoom-out`}
        onClick={() => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100))}
      >
        <IconZoomOut size={14} />
      </ActionIcon>
      <Text size="xs" className={classes.zoomLabel} data-testid={`${blockType}-zoom-label`}>
        {Math.round(zoom * 100)}%
      </Text>
      <ActionIcon
        size="xs"
        variant="subtle"
        aria-label="Zoom in"
        disabled={zoom >= ZOOM_MAX}
        data-testid={`${blockType}-zoom-in`}
        onClick={() => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100))}
      >
        <IconZoomIn size={14} />
      </ActionIcon>
    </Group>
  )

  const fitToggle = (
    <Tooltip label={fit ? UI_TEXT.diagramActualSizeLabel : UI_TEXT.diagramFitLabel}>
      <ActionIcon
        size="xs"
        variant="subtle"
        aria-label={fit ? UI_TEXT.diagramActualSizeLabel : UI_TEXT.diagramFitLabel}
        onClick={() => setFit((f) => !f)}
      >
        <IconAspectRatio size={14} />
      </ActionIcon>
    </Tooltip>
  )

  // The ProseMirror text host must exist in every state; visually hidden.
  const sourceHost = <div ref={contentRef} className={classes.hiddenSource} aria-hidden="true" />

  const renderSvg = (svg: string): JSX.Element => (
    <div
      className={`${classes.zoomHost} ${classes.svgHost} ${fit ? classes.fit : classes.actual}`}
      style={{ width: `${zoom * 100}%` }}
      data-testid={`${blockType}-svg`}
      // Sanitized by svg-sanitize.ts (script/handler/external-ref removal)
      // and Mermaid strict-mode DOMPurify before it reaches this state.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: contained sanitized SVG rendering
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )

  if (editing) {
    return (
      <div className={classes.editPane} data-testid={`${blockType}-edit`}>
        {sourceHost}
        <div className={classes.editSplit}>
          <div className={classes.editSource}>
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              minRows={6}
              autosize
              maxRows={18}
              aria-label={blockType === 'diagram' ? UI_TEXT.diagramLabel : UI_TEXT.mindMapLabel}
              data-testid={`${blockType}-source-input`}
            />
            {blockType === 'diagram' ? (
              <Select
                size="xs"
                className={classes.templateSelect}
                data-testid="diagram-template"
                aria-label={UI_TEXT.diagramTemplateLabel}
                placeholder={UI_TEXT.diagramTemplateLabel}
                clearable
                comboboxProps={{ withinPortal: true, zIndex: LAYOUT.overlayZIndex }}
                data={Object.entries(DIAGRAM_TEMPLATES).map(([value, def]) => ({
                  value,
                  label: def.label
                }))}
                onChange={(value) => {
                  if (value && DIAGRAM_TEMPLATES[value]) {
                    setDraft(DIAGRAM_TEMPLATES[value].source)
                  }
                }}
              />
            ) : null}
            <div className={classes.editActions}>
              <Button
                size="compact-xs"
                variant="filled"
                leftSection={<IconPlayerPlay size={12} />}
                onClick={apply}
                data-testid={`${blockType}-apply`}
              >
                {UI_TEXT.diagramApplyLabel}
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={cancel}
                data-testid={`${blockType}-cancel`}
              >
                {UI_TEXT.cancelButton}
              </Button>
            </div>
          </div>
          <div className={classes.editPreview}>
            <Group gap={4} wrap="nowrap" className={classes.previewToolbar}>
              {blockType === 'mindMap' ? zoomControls : null}
              {fitToggle}
            </Group>
            {liveError !== null ? (
              <Text size="sm" c="red" className={classes.previewError} role="alert">
                {ERROR_MESSAGES[liveError]}
              </Text>
            ) : liveSvg !== null ? (
              <div className={classes.previewScroll}>{renderSvg(liveSvg)}</div>
            ) : (
              <Text size="xs" c="dimmed" role="status">
                …
              </Text>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (errorCode !== null) {
    return (
      <div className={classes.errorPane} data-testid={`${blockType}-error`}>
        {sourceHost}
        <Text size="sm" c="red">
          {ERROR_MESSAGES[errorCode]}
        </Text>
        <div className={classes.editActions}>
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconRefresh size={12} />}
            onClick={() => setRenderSeq((seq) => seq + 1)}
            data-testid={`${blockType}-retry`}
          >
            {UI_TEXT.diagramRetryLabel}
          </Button>
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={startEditing}
            data-testid={`${blockType}-edit-button`}
          >
            {UI_TEXT.diagramEditLabel}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={classes.previewPane}
      data-testid={`${blockType}-preview`}
      data-rendered={committedSvg !== null}
    >
      {sourceHost}
      <Group gap={4} wrap="nowrap" className={classes.previewToolbar}>
        {blockType === 'mindMap' ? zoomControls : null}
        {fitToggle}
        <Tooltip label={UI_TEXT.diagramEditLabel} position="top">
          <ActionIcon
            className={classes.editButton}
            variant="subtle"
            size="sm"
            aria-label={UI_TEXT.diagramEditLabel}
            onClick={startEditing}
            data-testid={`${blockType}-edit-button`}
          >
            <IconPencil size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>
      {committedSvg !== null ? (
        <ResizableBlockContainer
          width={width}
          height={height}
          onCommit={onCommitSize ?? (() => undefined)}
          testIdPrefix={blockType}
        >
          <div
            className={classes.previewScroll}
            style={height !== '' ? { height: '100%' } : undefined}
          >
            {renderSvg(committedSvg)}
          </div>
        </ResizableBlockContainer>
      ) : (
        <Text size="xs" c="dimmed" role="status">
          …
        </Text>
      )}
    </div>
  )
}
