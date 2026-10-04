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
import { IconAspectRatio, IconPencil, IconPlayerPlay, IconRefresh } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { UI_TEXT } from '../../../config/index.js'
import { debugLog, safeHash } from '../../../diagnostics/debug-log.js'
import { RTWIKI_SCROLL } from '../../../theme/registry.js'
import { DIAGRAM_TEMPLATES } from '../insert-blocks.js'
import { ResizableBlockContainer } from './block-resize.js'
import { DiagramTemplateBar } from './diagram-template-bar.js'
import { DiagramView } from './diagram-view.js'
import classes from './mermaid-block.module.css'
import { renderMermaidSvg } from './mermaid-render.js'

/**
 * Shared preview-first view for Mermaid-backed blocks (Diagram, Mind Map).
 *
 * Normal view: the rendered (sanitized) SVG only, with a compact toolbar
 * (Edit and Fit/Actual). Edit view: a source editor on
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
  /**
   * The Mermaid renderer to use, defaulting to the editor's single
   * `renderMermaidSvg`.
   *
   * This exists so a test can drive the block's render *states* - committed,
   * in flight, errored - without replacing the renderer module process-wide.
   * A `mock.module` override of `mermaid-render.js` is global and, per Bun's own
   * documented behaviour, survives into every later test file: it made an
   * unrelated renderer test see the stub and fail depending on file order.
   * `attachMermaidDiagrams` takes its renderer the same way.
   */
  render?: typeof renderMermaidSvg
}

type RenderErrorCode = 'parse_error' | 'render_error'

const ERROR_MESSAGES: Record<RenderErrorCode, string> = {
  parse_error: UI_TEXT.diagramErrorTitle,
  render_error: UI_TEXT.diagramErrorTitle
}

export function MermaidBlockView({
  blockId,
  source,
  blockType,
  editor,
  contentRef,
  width = '',
  height = '',
  onCommitSize,
  render = renderMermaidSvg
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
    const ac = new AbortController()
    setErrorCode(null)
    void render(source, {
      theme: colorScheme === 'dark' ? 'dark' : 'default',
      blockId,
      blockType,
      signal: ac.signal
    }).then((result) => {
      if (gen !== committedGenRef.current) return
      if (result.ok) {
        setCommittedSvg(result.svg)
      } else {
        // A cancelled render was superseded or unmounted: it is not a failure
        // and must not blank the diagram or raise an error.
        if (result.code === 'cancelled' || result.code === 'empty_source') return
        setCommittedSvg(null)
        setErrorCode(result.code)
      }
    })
    return () => ac.abort()
  }, [source, colorScheme, renderSeq, blockId, blockType, render])

  // Debounce the live draft so typing never re-renders per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedDraft(draft), PREVIEW_REBUILD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft])

  // Live preview (edit view) — re-renders on debounced draft/theme/retry.
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderSeq is the manual Retry trigger and is intentionally not read inside the effect
  useEffect(() => {
    const gen = ++liveGenRef.current
    const ac = new AbortController()
    setLiveError(null)
    void render(debouncedDraft, {
      theme: colorScheme === 'dark' ? 'dark' : 'default',
      blockId,
      blockType,
      signal: ac.signal
    }).then((result) => {
      if (gen !== liveGenRef.current) return
      if (result.ok) {
        setLiveSvg(result.svg)
      } else {
        // Superseded or unmounted: not a failure, so keep whatever is shown.
        if (result.code === 'cancelled' || result.code === 'empty_source') return
        setLiveSvg(null)
        setLiveError(result.code)
      }
    })
    return () => ac.abort()
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
      // No `--zoom-level` and no `.zoomHost`. Those belonged to a second, older zoom
      // that sized the diagram by changing a layout width; the diagram's zoom is now
      // `DiagramView`'s transform, which is the only view both surfaces use and the
      // only one whose overflow is reachable (see `diagram-view.module.css`). Two
      // zoom mechanisms on one block meant the block's scale depended on which
      // controls the reader happened to press.
      className={`${classes.svgHost} ${fit ? classes.fit : classes.actual}`}
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
              /* The same bar the Diagram page uses, rather than a second,
                 different picker. Two ways to choose a template in one
                 application is the kind of inconsistency that has to be
                 remembered rather than discovered, and this way the block also
                 gets the variants (Flowchart's four directions) for free. */
              <DiagramTemplateBar
                onPick={(source) => {
                  setDraft(source)
                  debugLog('ui', 'ui_context_menu_action', {
                    targetId: blockId,
                    code: 'diagram-template-pick'
                  })
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
              {fitToggle}
            </Group>
            {liveError !== null ? (
              <Text size="sm" c="red" className={classes.previewError} role="alert">
                {ERROR_MESSAGES[liveError]}
              </Text>
            ) : liveSvg !== null ? (
              <div className={`${classes.previewScroll} ${RTWIKI_SCROLL}`}>
                {renderSvg(liveSvg)}
              </div>
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
      <Text size="xs" fw={600} className={classes.caption} data-testid={`${blockType}-caption`}>
        {blockType === 'diagram' ? UI_TEXT.diagramLabel : UI_TEXT.mindMapLabel}
      </Text>
      <Group gap={4} wrap="nowrap" className={classes.previewToolbar}>
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
            className={`${classes.previewScroll} ${RTWIKI_SCROLL}`}
            style={height !== '' ? { height: '100%' } : undefined}
          >
            {/* The diagram's own view — zoom, pan, reset, full screen — is the same
             * component the Diagram page uses, so the two surfaces cannot drift apart
             * again. It is separate from the block's size: these move the picture,
             * the corner handle changes the box, and neither affects the other.
             *
             * Its test ids are prefixed `note-view` rather than the block type so they
             * cannot collide with the block's own `diagram-` prefixed controls. It used
             * to matter more than that: a retired `mindMap` block carried a second,
             * toolbar zoom addressed as `mindMap-zoom-in`, and the two sets landed on
             * one id. That second zoom is gone — `DiagramView` is the only view. */}
            <DiagramView testIdPrefix="note-view">{renderSvg(committedSvg)}</DiagramView>
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
