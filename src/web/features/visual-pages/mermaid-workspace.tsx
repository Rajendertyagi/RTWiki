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
import type { PageType } from '@rtwiki/shared/contracts/pages'
import { parseVisualPageContent } from '@rtwiki/shared/schemas/visual-page-content'
import {
  IconAspectRatio,
  IconPencil,
  IconPlayerPlay,
  IconRefresh,
  IconZoomIn,
  IconZoomOut
} from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { LAYOUT, UI_TEXT } from '../../config/index.js'
import { debugLog, safeHash } from '../../diagnostics/debug-log.js'
import { updatePage } from '../../services/pages-api.js'
import { renderMermaidSvg } from '../rich-editor/blocks/mermaid-render.js'
import { DIAGRAM_TEMPLATES } from '../rich-editor/insert-blocks.js'
import { useAutosave } from '../rich-editor/use-autosave.js'
import classes from './mermaid-workspace.module.css'

/**
 * Dedicated full-page workspace for the Diagram and Mind Map page types.
 *
 * Normal opening shows the fully rendered diagram; Edit reveals a split view
 * with the Mermaid source on the left and a live debounced preview on the
 * right (Apply commits + exits, Cancel restores). Rendering reuses RTWiki's
 * secure Mermaid pipeline — never duplicated. Autosave flows through the
 * shared autosave controller so save status, flush-on-navigation and late-
 * response guards behave exactly like every other editor.
 */

export interface MermaidPageWorkspaceProps {
  pageId: string
  storedContent: string
  pageType: Extract<PageType, 'diagram' | 'mindmap'>
  onSaveContent?: (id: string, content: string) => Promise<boolean>
  onFlushRef?: (fn: (() => Promise<boolean>) | null) => void
  onSaveStateChange?: (state: {
    isDirty: boolean
    saveState: 'clean' | 'saving' | 'saved' | 'error'
  }) => void
}

type RenderErrorCode = 'parse_error' | 'render_error'

const ERROR_MESSAGE = UI_TEXT.diagramErrorTitle

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2
const ZOOM_STEP = 0.25

export default function MermaidPageWorkspace({
  pageId,
  storedContent,
  pageType,
  onSaveContent,
  onFlushRef,
  onSaveStateChange
}: MermaidPageWorkspaceProps): JSX.Element {
  // The secure Mermaid pipeline keys render IDs by block type; the mind-map
  // page type maps onto the pipeline's camelCase token.
  const mermaidBlockType: 'diagram' | 'mindMap' = pageType === 'mindmap' ? 'mindMap' : 'diagram'
  const parsed = parseVisualPageContent(storedContent)
  const committedSource = parsed.ok ? parsed.value.source : ''
  const parseFailed = !parsed.ok

  const colorScheme = useComputedColorScheme('light')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(committedSource)
  const [debouncedDraft, setDebouncedDraft] = useState(committedSource)
  const [svg, setSvg] = useState<string | null>(null)
  const [liveSvg, setLiveSvg] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<RenderErrorCode | null>(null)
  const [liveError, setLiveError] = useState<RenderErrorCode | null>(null)
  const [renderSeq, setRenderSeq] = useState(0)
  const [fit, setFit] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)

  const committedGenRef = useRef(0)
  const liveGenRef = useRef(0)

  const handleSave = async (pid: string, content: string): Promise<void> => {
    if (onSaveContent) {
      const ok = await onSaveContent(pid, content)
      if (!ok) throw new Error('Failed to save')
      return
    }
    await updatePage(pid, { content })
  }

  const { status, error, isDirty, notifyEdit, retry, flush } = useAutosave({
    pageId,
    onSave: handleSave
  })

  useEffect(() => {
    onSaveStateChange?.({ isDirty, saveState: status as 'clean' | 'saving' | 'saved' | 'error' })
  }, [isDirty, status, onSaveStateChange])

  useEffect(() => {
    onFlushRef?.(flush)
    return () => {
      onFlushRef?.(null)
    }
  }, [flush, onFlushRef])

  // Committed render (view mode) — generation token guards stale responses.
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderSeq is the manual Refresh trigger and is intentionally not read inside the effect
  useEffect(() => {
    const gen = ++committedGenRef.current
    setErrorCode(null)
    void renderMermaidSvg(committedSource, {
      theme: colorScheme === 'dark' ? 'dark' : 'default',
      blockId: pageId,
      blockType: mermaidBlockType
    }).then((result) => {
      if (gen !== committedGenRef.current) return
      if (result.ok) setSvg(result.svg)
      else {
        setSvg(null)
        setErrorCode(result.code)
      }
    })
  }, [committedSource, colorScheme, renderSeq, pageId, mermaidBlockType])

  // Debounced live draft for edit mode.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedDraft(draft), PREVIEW_REBUILD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft])

  // Live render (edit mode).
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderSeq is the manual Refresh trigger and is intentionally not read inside the effect
  useEffect(() => {
    const gen = ++liveGenRef.current
    setLiveError(null)
    void renderMermaidSvg(debouncedDraft, {
      theme: colorScheme === 'dark' ? 'dark' : 'default',
      blockId: pageId,
      blockType: mermaidBlockType
    }).then((result) => {
      if (gen !== liveGenRef.current) return
      if (result.ok) setLiveSvg(result.svg)
      else {
        setLiveSvg(null)
        setLiveError(result.code)
      }
    })
  }, [debouncedDraft, colorScheme, renderSeq, pageId, mermaidBlockType])

  const startEditing = (): void => {
    setDraft(committedSource)
    setEditing(true)
    debugLog('ui', 'ui_context_menu_action', { targetId: pageId, code: `${pageType}-page-edit` })
  }

  const apply = (): void => {
    setEditing(false)
    if (draft !== committedSource) {
      notifyEdit(JSON.stringify({ version: 1, type: pageType, source: draft }))
    }
    debugLog('ui', 'ui_context_menu_action', {
      targetId: pageId,
      code: `${pageType}-page-apply`,
      len: draft.length,
      hash: safeHash(draft)
    })
  }

  const cancel = (): void => {
    setDraft(committedSource)
    setEditing(false)
  }

  const zoomControls = (
    <Group gap={2} wrap="nowrap">
      <ActionIcon
        size="xs"
        variant="subtle"
        aria-label="Zoom out"
        data-testid={`${pageType}-zoom-out`}
        disabled={zoom <= ZOOM_MIN}
        onClick={() => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100))}
      >
        <IconZoomOut size={14} />
      </ActionIcon>
      <Text size="xs" data-testid={`${pageType}-zoom-label`}>
        {Math.round(zoom * 100)}%
      </Text>
      <ActionIcon
        size="xs"
        variant="subtle"
        aria-label="Zoom in"
        data-testid={`${pageType}-zoom-in`}
        disabled={zoom >= ZOOM_MAX}
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

  const refreshButton = (
    <Tooltip label={UI_TEXT.workspaceRefreshLabel}>
      <ActionIcon
        size="xs"
        variant="subtle"
        aria-label={UI_TEXT.workspaceRefreshLabel}
        data-testid={`${pageType}-refresh`}
        onClick={() => setRenderSeq((seq) => seq + 1)}
      >
        <IconRefresh size={14} />
      </ActionIcon>
    </Tooltip>
  )

  const fullscreenToggle = (
    <Tooltip
      label={fullscreen ? UI_TEXT.workspaceExitFullscreenLabel : UI_TEXT.workspaceFullscreenLabel}
    >
      <ActionIcon
        size="xs"
        variant="subtle"
        aria-label={
          fullscreen ? UI_TEXT.workspaceExitFullscreenLabel : UI_TEXT.workspaceFullscreenLabel
        }
        data-testid={`${pageType}-fullscreen`}
        onClick={() => setFullscreen((f) => !f)}
      >
        {fullscreen ? '⤡' : '⤢'}
      </ActionIcon>
    </Tooltip>
  )

  const renderSvgArea = (currentSvg: string): JSX.Element => (
    <div className={`${classes.svgHost} ${fit ? classes.fit : classes.actual}`}>
      <div className={classes.zoomHost} style={{ width: `${zoom * 100}%` }}>
        {/* Sanitized by svg-sanitize.ts + Mermaid strict-mode DOMPurify. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: contained sanitized SVG rendering */}
        <div dangerouslySetInnerHTML={{ __html: currentSvg }} />
      </div>
    </div>
  )

  const statusLabel =
    status === 'error'
      ? UI_TEXT.saveStatusError
      : status === 'saving'
        ? UI_TEXT.saveStatusSaving
        : isDirty
          ? '…'
          : UI_TEXT.saveStatusSaved

  return (
    <div
      className={`${classes.root} ${fullscreen ? classes.fullscreen : ''}`}
      data-testid={`${pageType}-workspace`}
      data-mode={editing ? 'edit' : 'view'}
    >
      {parseFailed ? (
        <Text size="sm" c="red" role="alert" data-testid={`${pageType}-parse-error`}>
          {parsed.error}
        </Text>
      ) : editing ? (
        <>
          <Group justify="space-between" wrap="nowrap" className={classes.editBar}>
            <Group gap="xs" wrap="nowrap">
              <Button
                size="compact-xs"
                variant="filled"
                leftSection={<IconPlayerPlay size={12} />}
                onClick={apply}
                data-testid={`${pageType}-apply`}
              >
                {UI_TEXT.diagramApplyLabel}
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={cancel}
                data-testid={`${pageType}-cancel`}
              >
                {UI_TEXT.cancelButton}
              </Button>
              {pageType === 'diagram' ? (
                <Select
                  size="xs"
                  w={180}
                  data-testid={`${pageType}-template`}
                  aria-label={UI_TEXT.diagramTemplateLabel}
                  placeholder={UI_TEXT.diagramTemplateLabel}
                  clearable
                  comboboxProps={{ withinPortal: true, zIndex: LAYOUT.overlayZIndex }}
                  data={Object.entries(DIAGRAM_TEMPLATES).map(([value, def]) => ({
                    value,
                    label: def.label
                  }))}
                  onChange={(value) => {
                    if (value && DIAGRAM_TEMPLATES[value]) setDraft(DIAGRAM_TEMPLATES[value].source)
                  }}
                />
              ) : null}
            </Group>
            <Group gap={4} wrap="nowrap">
              {refreshButton}
              {fitToggle}
              {zoomControls}
              {fullscreenToggle}
            </Group>
          </Group>
          <div className={classes.editSplit}>
            <Textarea
              className={classes.sourcePane}
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              minRows={10}
              autosize
              maxRows={28}
              aria-label={UI_TEXT.workspaceSourceLabel}
              data-testid={`${pageType}-source-input`}
            />
            <div className={classes.previewPane} data-testid={`${pageType}-live-preview`}>
              {liveError !== null ? (
                <Text size="sm" c="red" role="alert" className={classes.previewError}>
                  {ERROR_MESSAGE}
                </Text>
              ) : liveSvg !== null ? (
                renderSvgArea(liveSvg)
              ) : (
                <Text size="xs" c="dimmed" role="status">
                  …
                </Text>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <Group justify="flex-end" gap={4} wrap="nowrap" className={classes.viewBar}>
            <Button
              size="compact-xs"
              variant="light"
              leftSection={<IconPencil size={12} />}
              onClick={startEditing}
              data-testid={`${pageType}-edit-button`}
            >
              {UI_TEXT.diagramWorkspaceEditLabel}
            </Button>
            {refreshButton}
            {fitToggle}
            {zoomControls}
            {fullscreenToggle}
          </Group>
          <div className={classes.viewHost} data-testid={`${pageType}-rendered`}>
            {errorCode !== null ? (
              <div className={classes.errorBox} data-testid={`${pageType}-error`} role="alert">
                <Text size="sm" c="red">
                  {ERROR_MESSAGE}
                </Text>
                <Button
                  size="compact-xs"
                  variant="light"
                  mt="xs"
                  leftSection={<IconRefresh size={12} />}
                  onClick={() => setRenderSeq((seq) => seq + 1)}
                  data-testid={`${pageType}-retry`}
                >
                  {UI_TEXT.diagramRetryLabel}
                </Button>
              </div>
            ) : svg !== null ? (
              renderSvgArea(svg)
            ) : (
              <Text size="xs" c="dimmed" role="status">
                …
              </Text>
            )}
          </div>
        </>
      )}

      <div className={classes.statusRow} data-testid={`${pageType}-save-status`}>
        <Text size="xs" c={status === 'error' ? 'red' : 'dimmed'}>
          {status === 'error'
            ? `${UI_TEXT.saveStatusError}${error ? `: ${error}` : ''}`
            : statusLabel}
        </Text>
        {status === 'error' ? (
          <Button size="compact-xs" variant="light" ml="xs" onClick={() => void retry()}>
            {UI_TEXT.saveStatusRetry}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
