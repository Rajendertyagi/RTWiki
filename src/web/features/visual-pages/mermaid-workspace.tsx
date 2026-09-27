import {
  ActionIcon,
  Button,
  Group,
  Text,
  Textarea,
  Tooltip,
  useComputedColorScheme
} from '@mantine/core'
import { PREVIEW_REBUILD_DEBOUNCE_MS } from '@rtwiki/shared/constants'
import type { PageType } from '@rtwiki/shared/contracts/pages'
import {
  MAX_VISUAL_PAGE_BLOCKS,
  parseVisualPageContent,
  serializeVisualPageBlocks,
  type VisualPageBlock
} from '@rtwiki/shared/schemas/visual-page-content'
import {
  IconAspectRatio,
  IconChevronDown,
  IconChevronUp,
  IconPencil,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconZoomIn,
  IconZoomOut
} from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { debugLog, safeHash } from '../../diagnostics/debug-log.js'
import { updatePage } from '../../services/pages-api.js'
import type { CSSVars } from '../../style-props.js'
import { reorderByIds } from '../../util/reorder.js'
import { DiagramTemplateBar } from '../rich-editor/blocks/diagram-template-bar.js'
import { renderMermaidSvg } from '../rich-editor/blocks/mermaid-render.js'
import { useAutosave } from '../rich-editor/use-autosave.js'
import { RightSidebarRegion } from '../workspace/right-sidebar-region.js'
import { DiagramCanvas, type RenderErrorCode } from './diagram-canvas.js'
import classes from './mermaid-workspace.module.css'
import { starterSourceFor } from './starter-source.js'

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
  createdDate?: string
  updatedDate?: string
  onSaveContent?: (id: string, content: string) => Promise<boolean>
  onFlushRef?: (fn: (() => Promise<boolean>) | null) => void
  onSaveStateChange?: (state: {
    isDirty: boolean
    saveState: 'clean' | 'saving' | 'saved' | 'error'
    error?: string | null
  }) => void
  /** Opens a page through the controller/tab flow, for the sidebar's backlinks. */
  onOpenPage?: (pageId: string) => void
}

const ERROR_MESSAGE = UI_TEXT.diagramErrorTitle
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2
const ZOOM_STEP = 0.25

export default function MermaidPageWorkspace({
  pageId,
  storedContent,
  pageType,
  createdDate,
  updatedDate,
  onSaveContent,
  onFlushRef,
  onSaveStateChange,
  onOpenPage
}: MermaidPageWorkspaceProps): JSX.Element {
  // The secure Mermaid pipeline keys render IDs by block type; the mind-map
  // page type maps onto the pipeline's camelCase token.
  const mermaidBlockType: 'diagram' | 'mindMap' = pageType === 'mindmap' ? 'mindMap' : 'diagram'
  const parsed = parseVisualPageContent(storedContent)
  // The page's blocks, as stored. A v1 page reads as a one-block page, so a page
  // written before the format gained a block list needs no special case here.
  const committedBlocks: VisualPageBlock[] = parsed.ok ? parsed.value.blocks : []
  const parseFailed = !parsed.ok

  const colorScheme = useComputedColorScheme('light')
  // Which block the source editor is open on, or null when viewing the page. A
  // block index rather than a flag, because the editor edits one block at a time
  // while the page can hold many.
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [debouncedDraft, setDebouncedDraft] = useState('')
  const [liveSvg, setLiveSvg] = useState<string | null>(null)
  const [liveError, setLiveError] = useState<RenderErrorCode | null>(null)
  // Bumped by the page-level Refresh. It reaches every block, so one press
  // re-renders the whole page rather than only the block that happens to be
  // failing.
  const [renderSeq, setRenderSeq] = useState(0)
  const [fit, setFit] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)

  const liveGenRef = useRef(0)

  const handleSave = async (pid: string, content: string): Promise<void> => {
    if (onSaveContent) {
      const ok = await onSaveContent(pid, content)
      if (!ok) throw new Error('Failed to save')
      return
    }
    await updatePage(pid, { content })
  }

  const { status, error, isDirty, notifyEdit, flush } = useAutosave({
    pageId,
    onSave: handleSave
  })

  useEffect(() => {
    onSaveStateChange?.({
      isDirty,
      saveState: status as 'clean' | 'saving' | 'saved' | 'error',
      error: status === 'error' ? error : null
    })
  }, [isDirty, status, error, onSaveStateChange])

  useEffect(() => {
    onFlushRef?.(flush)
    return () => {
      onFlushRef?.(null)
    }
  }, [flush, onFlushRef])

  // Debounced live draft for edit mode.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedDraft(draft), PREVIEW_REBUILD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft])

  // Live render (edit mode).
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderSeq is the manual Refresh trigger and is intentionally not read inside the effect
  useEffect(() => {
    const gen = ++liveGenRef.current
    const ac = new AbortController()
    setLiveError(null)
    void renderMermaidSvg(debouncedDraft, {
      theme: colorScheme === 'dark' ? 'dark' : 'default',
      blockId: pageId,
      blockType: mermaidBlockType,
      signal: ac.signal
    }).then((result) => {
      if (gen !== liveGenRef.current) return
      if (result.ok) setLiveSvg(result.svg)
      else {
        // Superseded or unmounted: not a failure, so keep the current diagram.
        if (result.code === 'cancelled') return
        setLiveSvg(null)
        setLiveError(result.code)
      }
    })
    return () => ac.abort()
  }, [debouncedDraft, colorScheme, renderSeq, pageId, mermaidBlockType])

  const startEditing = (index: number): void => {
    const block = committedBlocks[index]
    if (!block) return
    setDraft(block.source)
    setEditingIndex(index)
    debugLog('ui', 'ui_context_menu_action', { targetId: pageId, code: `${pageType}-page-edit` })
  }

  const apply = (): void => {
    const index = editingIndex
    setEditingIndex(null)
    if (index === null) return
    const current = committedBlocks[index]
    if (!current || draft === current.source) {
      debugLog('ui', 'ui_context_menu_action', {
        targetId: pageId,
        code: `${pageType}-page-apply`,
        len: draft.length,
        hash: safeHash(draft)
      })
      return
    }
    // Written as v2 with the *whole* block list, replacing only the block being
    // edited. Writing v1 here would look correct for a single-diagram page and
    // silently collapse a multi-block page to one diagram, because a v1 document
    // parses as exactly one block — the other diagrams would be discarded with
    // no error anywhere.
    const next = committedBlocks.map((block, i) =>
      i === index ? { ...block, source: draft } : block
    )
    notifyEdit(serializeVisualPageBlocks(pageType, next))
    debugLog('ui', 'ui_context_menu_action', {
      targetId: pageId,
      code: `${pageType}-page-apply`,
      len: draft.length,
      hash: safeHash(draft)
    })
  }

  const cancel = (): void => {
    setEditingIndex(null)
  }

  /**
   * Commits a structural change to the block list - add, remove or reorder.
   *
   * Every one of these writes the whole list, so there is a single write path for
   * the page's shape rather than one per action.
   */
  const commitBlocks = (next: VisualPageBlock[], code: string): void => {
    notifyEdit(serializeVisualPageBlocks(pageType, next))
    debugLog('ui', 'ui_context_menu_action', { targetId: pageId, code, len: next.length })
  }

  const addBlock = (): void => {
    // Capped in the schema as well; refusing here means the button explains itself
    // instead of the save failing.
    if (committedBlocks.length >= MAX_VISUAL_PAGE_BLOCKS) return
    commitBlocks(
      [...committedBlocks, { id: crypto.randomUUID(), source: starterSourceFor(pageType) }],
      `${pageType}-block-add`
    )
  }

  const removeBlock = (index: number): void => {
    // The schema requires at least one block, so the last one cannot be removed.
    // Deleting every diagram would leave a page that cannot be rendered at all.
    if (committedBlocks.length <= 1) return
    commitBlocks(
      committedBlocks.filter((_, i) => i !== index),
      `${pageType}-block-remove`
    )
  }

  const moveBlock = (index: number, delta: -1 | 1): void => {
    const target = index + delta
    if (target < 0 || target >= committedBlocks.length) return
    const ids = committedBlocks.map((block) => block.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(target, 0, moved)
    commitBlocks(
      reorderByIds(committedBlocks, ids, (block) => block.id),
      `${pageType}-block-move`
    )
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
      <div className={classes.zoomHost} style={{ '--zoom-level': `${zoom * 100}%` } as CSSVars}>
        {/* Sanitized by svg-sanitize.ts + Mermaid strict-mode DOMPurify. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: contained sanitized SVG rendering */}
        <div dangerouslySetInnerHTML={{ __html: currentSvg }} />
      </div>
    </div>
  )

  /**
   * One block's card in view mode: the diagram plus the actions that apply to
   * that block alone.
   *
   * Reordering is offered as Move up / Move down rather than only as a drag. Both
   * are legitimate, but buttons are reachable from the keyboard and name
   * themselves to a screen reader, whereas a drag handle is neither. The order
   * they produce is the same, and it goes through the shared `reorderByIds` rule
   * the tab strip uses, so a block can never be dropped or duplicated by a
   * malformed order.
   */
  /**
   * "Diagram 2 of 3". Interpolated here rather than in the dictionary, because
   * `UI_TEXT` holds plain strings - every consumer iterates its values - so a
   * counted label is stored as a `{placeholder}` pattern and filled in at the call
   * site, exactly as the status bar does it.
   */
  const blockLabel = (position: number, total: number): string =>
    UI_TEXT.diagramBlockLabel
      .replace('{position}', String(position))
      .replace('{total}', String(total))

  const blockCard = (block: VisualPageBlock, index: number): JSX.Element => (
    <section
      key={block.id}
      className={classes.blockCard}
      aria-label={blockLabel(index + 1, committedBlocks.length)}
      data-testid={`${pageType}-block-${index}`}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs" className={classes.blockBar}>
        <Text size="xs" c="dimmed" data-testid={`${pageType}-block-title-${index}`}>
          {blockLabel(index + 1, committedBlocks.length)}
        </Text>
        <Group gap={2} wrap="nowrap">
          <Tooltip label={UI_TEXT.diagramEditBlockLabel}>
            <ActionIcon
              size="xs"
              variant="subtle"
              aria-label={UI_TEXT.diagramEditBlockLabel}
              onClick={() => startEditing(index)}
              data-testid={`${pageType}-block-edit-${index}`}
            >
              <IconPencil size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={UI_TEXT.diagramMoveBlockUpLabel}>
            <ActionIcon
              size="xs"
              variant="subtle"
              aria-label={UI_TEXT.diagramMoveBlockUpLabel}
              // The first block cannot move up, so the control says so rather than
              // doing nothing when pressed.
              disabled={index === 0}
              onClick={() => moveBlock(index, -1)}
              data-testid={`${pageType}-block-up-${index}`}
            >
              <IconChevronUp size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={UI_TEXT.diagramMoveBlockDownLabel}>
            <ActionIcon
              size="xs"
              variant="subtle"
              aria-label={UI_TEXT.diagramMoveBlockDownLabel}
              disabled={index === committedBlocks.length - 1}
              onClick={() => moveBlock(index, 1)}
              data-testid={`${pageType}-block-down-${index}`}
            >
              <IconChevronDown size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={UI_TEXT.diagramRemoveBlockLabel}>
            <ActionIcon
              size="xs"
              variant="subtle"
              aria-label={UI_TEXT.diagramRemoveBlockLabel}
              // The last remaining diagram cannot be removed: a page with none
              // cannot be rendered at all.
              disabled={committedBlocks.length <= 1}
              onClick={() => removeBlock(index)}
              data-testid={`${pageType}-block-remove-${index}`}
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <div className={classes.blockCanvas} data-testid={`${pageType}-rendered`}>
        <DiagramCanvas
          source={block.source}
          renderKey={`${pageId}-${block.id}`}
          mermaidBlockType={mermaidBlockType}
          colorScheme={colorScheme}
          fit={fit}
          zoom={zoom}
          renderSeq={renderSeq}
          testId={`${pageType}-block-${index}`}
        />
      </div>
    </section>
  )

  // A diagram or mind map has no headings, so the panel carries backlinks and
  // page information only - `outline` is omitted rather than passed empty, which
  // is what keeps an empty "Outline" heading off these pages.
  //
  // Fullscreen deliberately drops the panel: the whole point of fullscreen is an
  // unobstructed diagram, and a pane the reader cannot collapse would defeat it.
  const sidebar = fullscreen ? null : (
    <RightSidebarRegion
      pageId={pageId}
      pageTypeLabel={pageType === 'mindmap' ? UI_TEXT.mindMapPage : UI_TEXT.diagramPage}
      createdDate={createdDate ?? ''}
      updatedDate={updatedDate ?? ''}
      onOpenPage={onOpenPage}
    />
  )

  return (
    <div
      className={`${classes.root} ${fullscreen ? classes.fullscreen : ''}`}
      data-testid={`${pageType}-workspace`}
      data-mode={editingIndex === null ? 'view' : 'edit'}
    >
      {parseFailed ? (
        <Text size="sm" c="red" role="alert" data-testid={`${pageType}-parse-error`}>
          {parsed.error}
        </Text>
      ) : editingIndex !== null ? (
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
              </Button>{' '}
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={cancel}
                data-testid={`${pageType}-cancel`}
              >
                {UI_TEXT.cancelButton}
              </Button>
            </Group>
            <Group gap={4} wrap="nowrap">
              {refreshButton}
              {fitToggle}
              {zoomControls}
              {fullscreenToggle}
            </Group>
          </Group>
          {pageType === 'diagram' ? (
            // Its own row, directly under the edit bar: one row of template
            // controls, never wrapping, never scrolling, with whatever does not
            // fit split into a trailing dropdown by the shared overflow hook —
            // the same behaviour as the rich document toolbar.
            <DiagramTemplateBar
              onPick={(source) => {
                setDraft(source)
                debugLog('ui', 'ui_context_menu_action', {
                  targetId: pageId,
                  code: `${pageType}-template-pick`,
                  len: source.length,
                  hash: safeHash(source)
                })
              }}
            />
          ) : null}
          <div className={classes.contentRow}>
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
            {sidebar}
          </div>
        </>
      ) : (
        <>
          <Group justify="space-between" gap={4} wrap="nowrap" className={classes.viewBar}>
            <Button
              size="compact-xs"
              variant="light"
              leftSection={<IconPlus size={12} />}
              onClick={addBlock}
              // Disabled rather than failing on click: the cap is a real limit and
              // the control should say so instead of doing nothing.
              disabled={committedBlocks.length >= MAX_VISUAL_PAGE_BLOCKS}
              data-testid={`${pageType}-add-block`}
            >
              {UI_TEXT.diagramAddBlockLabel}
            </Button>
            <Group gap={4} wrap="nowrap">
              {refreshButton}
              {fitToggle}
              {zoomControls}
              {fullscreenToggle}
            </Group>
          </Group>
          <div className={classes.contentRow}>
            <div className={classes.blockList} data-testid={`${pageType}-block-list`}>
              {committedBlocks.map((block, index) => blockCard(block, index))}
            </div>
            {sidebar}
          </div>
        </>
      )}
    </div>
  )
}
