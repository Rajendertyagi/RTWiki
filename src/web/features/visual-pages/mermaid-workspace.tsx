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
  IconPlayerPlay,
  IconRefresh,
  IconZoomIn,
  IconZoomOut
} from '@tabler/icons-react'
import { Reorder } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { debugLog, safeHash } from '../../diagnostics/debug-log.js'
import { updatePage } from '../../services/pages-api.js'
import type { CSSVars } from '../../style-props.js'
import { reorderByIds } from '../../util/reorder.js'
import { renderMermaidSvg } from '../rich-editor/blocks/mermaid-render.js'
import { useAutosave } from '../rich-editor/use-autosave.js'
import { RightSidebarRegion } from '../workspace/right-sidebar-region.js'
import { mapAutosaveStatus, type StatusSaveState } from '../workspace/save-state.js'
import { DiagramBlockCard } from './diagram-block-card.js'
import type { RenderErrorCode } from './diagram-canvas.js'
import classes from './mermaid-workspace.module.css'
import { starterSourceFor } from './starter-source.js'

/**
 * Dedicated full-page workspace for the Diagram page type.
 *
 * Normal opening shows the fully rendered diagrams. Edit reveals a split view
 * with the Mermaid source on the left and a live debounced preview on the
 * right (Apply commits + exits, Cancel restores). Rendering reuses RTWiki's
 * secure Mermaid pipeline — never duplicated. Autosave flows through the
 * shared autosave controller so save status, flush-on-navigation and late-
 * response guards behave exactly like every other editor.
 *
 * The page's creation controls are **not** rendered here. "Add diagram" and the
 * Mermaid template chooser live in the page's own toolbar row, beside the Rich
 * Note's, and reach this workspace through
 * {@link MermaidPageWorkspaceProps.onCreateActionsReady} — the same arrangement
 * the Rich Note uses to put its toolbar in the shared row while the editor
 * instance stays down here.
 *
 * Both creation actions travel in **one** handoff rather than one callback each.
 * A second independent callback would mean a second registration with the same
 * teardown semantics, and the first version of this arrangement already had that
 * shape: a single callback whose value was a bare function, which a `setState` on
 * the other end called as an updater. One object, registered once, makes that
 * unrepresentable rather than merely avoided.
 */

/**
 * What the Diagram page's toolbar row needs in order to create a diagram.
 *
 * Held and handed up as an **object**, never as bare functions, for the reason in
 * the module note: a `useState` given a function invokes it as an updater with the
 * previous state. An object cannot be mistaken for an updater.
 */
export interface DiagramCreateActions {
  /** Appends a diagram of this Mermaid source, at full page width. */
  pickTemplate: (source: string) => void
  /** Appends a diagram of the default starter, at full page width. */
  addDiagram: () => void
  /**
   * Whether another diagram may be added right now.
   *
   * Carried rather than recomputed by the toolbar, because `MAX_VISUAL_PAGE_BLOCKS`
   * is a limit this module owns and a second copy of it in the toolbar would be
   * free to drift.
   */
  canAdd: boolean
}

export interface MermaidPageWorkspaceProps {
  pageId: string
  storedContent: string
  pageType: Extract<PageType, 'diagram'>
  createdDate?: string
  updatedDate?: string
  onSaveContent?: (id: string, content: string) => Promise<boolean>
  onFlushRef?: (fn: (() => Promise<boolean>) | null) => void
  onSaveStateChange?: (state: {
    isDirty: boolean
    saveState: StatusSaveState
    error?: string | null
  }) => void
  /** Opens a page through the controller/tab flow, for the sidebar's backlinks. */
  onOpenPage?: (pageId: string) => void
  /**
   * Hands this workspace's "add a diagram of this type" action up to whoever
   * renders the page's toolbar row, and is called with `null` on unmount.
   *
   * The mirror image of the Rich Note's `onEditorReady`: the control belongs in
   * the shared toolbar row so the page looks like every other page type, while
   * the state it acts on lives down here. Handing over a function rather than a
   * node means the toolbar never re-renders because the workspace re-rendered.
   */
  onCreateActionsReady?: (actions: DiagramCreateActions | null) => void
}

const ERROR_MESSAGE = UI_TEXT.diagramErrorTitle
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2
const ZOOM_STEP = 0.25

/**
 * Shared empty list for unparseable content, so a page that fails to parse does
 * not hand a fresh array to state on every render and reconcile forever.
 */
const NO_BLOCKS: VisualPageBlock[] = []

export default function MermaidPageWorkspace({
  pageId,
  storedContent,
  pageType,
  createdDate,
  updatedDate,
  onSaveContent,
  onFlushRef,
  onSaveStateChange,
  onOpenPage,
  onCreateActionsReady
}: MermaidPageWorkspaceProps): JSX.Element {
  // The secure Mermaid pipeline keys its render IDs by block type. The Mind Map
  // page is retired, so a Diagram page is always the `diagram` token. The
  // `mindMap` token still exists further down for reading a Mind Map block
  // inside a rich note (blocks/diagram.tsx), which is a different surface.
  const MERMAID_BLOCK_TYPE = 'diagram' as const
  // Parsed once per stored document rather than per render, so the block list
  // below is referentially stable while `storedContent` is unchanged.
  const parsed = useMemo(() => parseVisualPageContent(storedContent), [storedContent])
  // The page's blocks, as stored. A v1 page reads as a one-block page, so a page
  // written before the format gained a block list needs no special case here.
  const storedBlocks: VisualPageBlock[] = parsed.ok ? parsed.value.blocks : NO_BLOCKS
  const parseFailed = !parsed.ok

  /**
   * The block list every write is built from, and the page's live state.
   *
   * It is state rather than a value derived from `storedContent`, because the
   * prop only refreshes after a successful round-trip to the server, and writes
   * are debounced. Deriving it from the prop therefore meant a second mutation
   * inside the debounce window computed from a list that predated the first: two
   * presses of Add within the window left the first new diagram in memory but not
   * in the document that was written, and the save then succeeded and reported
   * "Saved". Nothing errored and the diagram was simply gone. It survived a
   * failed save too, which is worse, because the stale snapshot then lasted
   * until something refreshed the prop.
   *
   * Reconciliation with the server is below; the invariant is that a local list
   * is only ever replaced by a *newer* server document, never by an older one.
   */
  const [blocks, setBlocks] = useState<VisualPageBlock[]>(storedBlocks)

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
      // The shared mapping, not a cast. Casting let `'dirty'` through as a value
      // the status bar does not recognise, which fell through to "Saved" - so a
      // page mid-debounce announced itself as saved. This is the last editor that
      // still did it that way; see `workspace/save-state.ts`.
      saveState: mapAutosaveStatus(status),
      error: status === 'error' ? error : null
    })
  }, [isDirty, status, error, onSaveStateChange])

  /**
   * The document this workspace last handed to autosave, or null before its
   * first write. Reconciliation reads it to tell two very different prop changes
   * apart, which are otherwise indistinguishable: the server confirming this
   * workspace's own write, and the server holding a document that a local edit
   * has already superseded.
   */
  const localContentRef = useRef<string | null>(null)
  const localPageIdRef = useRef(pageId)

  /**
   * Adopts the server's block list, but never a stale one.
   *
   * The rule is one-directional. A prop equal to the document this workspace last
   * wrote is that write coming back, and adopting it changes nothing. A prop that
   * differs while a local write is outstanding is *older* than what is on screen -
   * the debounce has not fired, or the save failed - and adopting it would delete
   * a block the user can see. So the local list stands, and the next mutation is
   * written from it, which is what makes a failed save recoverable instead of
   * permanent.
   */
  useEffect(() => {
    const openedAnotherPage = localPageIdRef.current !== pageId
    localPageIdRef.current = pageId
    const serverIsBehind =
      localContentRef.current !== null && localContentRef.current !== storedContent
    if (!openedAnotherPage && serverIsBehind) return
    setBlocks(storedBlocks)
  }, [pageId, storedContent, storedBlocks])

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
      blockType: MERMAID_BLOCK_TYPE,
      signal: ac.signal
    }).then((result) => {
      if (gen !== liveGenRef.current) return
      if (result.ok) setLiveSvg(result.svg)
      else {
        // Superseded or unmounted: not a failure, so keep the current diagram.
        if (result.code === 'cancelled' || result.code === 'empty_source') return
        setLiveSvg(null)
        setLiveError(result.code)
      }
    })
    return () => ac.abort()
  }, [debouncedDraft, colorScheme, renderSeq, pageId])

  const startEditing = (index: number): void => {
    const block = blocks[index]
    if (!block) return
    setDraft(block.source)
    setEditingIndex(index)
    debugLog('ui', 'ui_context_menu_action', { targetId: pageId, code: `${pageType}-page-edit` })
  }

  /**
   * Makes a new block list both the page's state and the document that will be
   * written.
   *
   * These are deliberately the same call. Setting the state and notifying autosave
   * separately is what let a write be built from a list that predated it: the
   * second press of Add inside the debounce window read a list the first press
   * had not reached yet, so the diagram the first press added was absent from the
   * write and vanished on a save that reported success.
   *
   * `localContentRef` is what the reconciliation effect above compares the next
   * `storedContent` against, so recording it here is part of the same invariant.
   */
  const adoptBlocks = (next: VisualPageBlock[]): void => {
    const content = serializeVisualPageBlocks(pageType, next)
    localContentRef.current = content
    setBlocks(next)
    notifyEdit(content)
  }

  const apply = (): void => {
    const index = editingIndex
    setEditingIndex(null)
    if (index === null) return
    const current = blocks[index]
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
    adoptBlocks(blocks.map((block, i) => (i === index ? { ...block, source: draft } : block)))
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
    adoptBlocks(next)
    debugLog('ui', 'ui_context_menu_action', { targetId: pageId, code, len: next.length })
  }

  const addBlock = (): void => {
    // Capped against the list that is actually written, not against what the
    // server last confirmed: a burst of presses inside one debounce window is
    // written as a single document, so the cap has to be read from the list the
    // next write is built from or the burst would walk straight past it. The
    // schema caps it again, and refusing here means the button explains itself
    // instead of the save failing.
    if (blocks.length >= MAX_VISUAL_PAGE_BLOCKS) return
    commitBlocks(
      [...blocks, { id: crypto.randomUUID(), source: starterSourceFor() }],
      `${pageType}-block-add`
    )
  }

  /**
   * Appends a diagram of the chosen type, at full page width.
   *
   * This is what the toolbar's template bar calls, and it is the whole point of
   * moving that bar to the top: choosing a template adds that diagram, rather
   * than requiring a generic diagram to be added first and then replaced.
   *
   * A new block carries no stored size, which the layout reads as "take the full
   * width available". A user who then resizes it has stored a preference, and a
   * block added afterwards is unaffected by it.
   */
  const addBlockWithSource = (source: string): void => {
    if (blocks.length >= MAX_VISUAL_PAGE_BLOCKS) return
    commitBlocks([...blocks, { id: crypto.randomUUID(), source }], `${pageType}-block-add-template`)
  }

  // The toolbar row above this workspace owns the page's creation controls.
  //
  // `addBlockWithSource` closes over `blocks` and is therefore a new function on
  // every render, so registering it directly would tear the handler down and set
  // it back up each time - and each teardown nulls it, which the toolbar reads as
  // "no toolbar yet" and renders a placeholder. A ref holding the latest one lets
  // the registration happen exactly once per mount, and the toolbar still calls
  // the current closure.
  const addBlockWithSourceRef = useRef(addBlockWithSource)
  useEffect(() => {
    addBlockWithSourceRef.current = addBlockWithSource
  })

  // The same treatment for the bare "add a default diagram" action, because it
  // closes over `blocks` for the cap check and is therefore a new closure per
  // render for exactly the reason `addBlockWithSource` is.
  const addBlockRef = useRef(addBlock)
  useEffect(() => {
    addBlockRef.current = addBlock
  })

  /**
   * The actions the toolbar row needs, always current.
   *
   * `canAdd` is part of the handoff rather than something the toolbar guesses:
   * the cap is `MAX_VISUAL_PAGE_BLOCKS` and only this component knows whether it
   * has been reached, so a toolbar-side check would be a second copy of a limit
   * that lives here. Carrying it means the button is genuinely disabled at the
   * cap and says so, instead of being clickable and silently doing nothing.
   */
  const canAddBlock = blocks.length < MAX_VISUAL_PAGE_BLOCKS
  const readCreateActions = (): DiagramCreateActions => ({
    pickTemplate: (source: string) => addBlockWithSourceRef.current(source),
    // Both actions call *through* their ref rather than storing what it holds.
    //
    // Storing `addBlockRef.current` looked equivalent and was not: the stored
    // value would be the closure from the render at registration time, closing
    // over that render's `blocks`. Its cap check and its `[...blocks, newBlock]`
    // would then always be computed from the list as it was when the toolbar
    // appeared, so every press after the first rebuilt the same list instead of
    // extending it — two presses produced one new block, not two.
    // `tests/browser/visual-debounce-window.pwspec.ts` caught it.
    addDiagram: () => addBlockRef.current(),
    canAdd: canAddBlock
  })

  // Registered on mount and cleared on unmount, so a closed page cannot leave a
  // handler behind that would append a diagram to a page no longer on screen.
  //
  // Registration and refresh are deliberately two effects. One effect depending on
  // both would tear down (nulling the toolbar, so it renders its skeleton) and
  // re-register on every add or remove, so the bar would visibly flash to a
  // placeholder each time a diagram was added. The second effect has no cleanup,
  // so it updates in place.
  //
  // `readCreateActions` is intentionally absent from both dependency lists. It is a
  // new closure every render, so listing it would re-run these on every render —
  // and the first effect would then null the toolbar each time, which is the exact
  // flash this split exists to prevent. The dependencies that matter are the
  // callback identity and `canAddBlock`, which is the only value the toolbar reads
  // that can change without a re-registration.
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above - readCreateActions is a per-render closure and listing it would re-register on every render.
  useEffect(() => {
    if (!onCreateActionsReady) return
    onCreateActionsReady(readCreateActions())
    return () => onCreateActionsReady(null)
  }, [onCreateActionsReady])

  // biome-ignore lint/correctness/useExhaustiveDependencies: as above - only canAddBlock can change the handed-up value without a remount.
  useEffect(() => {
    if (!onCreateActionsReady) return
    onCreateActionsReady(readCreateActions())
  }, [onCreateActionsReady, canAddBlock])

  const removeBlock = (index: number): void => {
    // The schema requires at least one block, so the last one cannot be removed.
    // Deleting every diagram would leave a page that cannot be rendered at all.
    if (blocks.length <= 1) return
    commitBlocks(
      blocks.filter((_, i) => i !== index),
      `${pageType}-block-remove`
    )
  }

  const moveBlock = (index: number, delta: -1 | 1): void => {
    const target = index + delta
    if (target < 0 || target >= blocks.length) return
    const ids = blocks.map((block) => block.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(target, 0, moved)
    commitBlocks(
      reorderByIds(blocks, ids, (block) => block.id),
      `${pageType}-block-move`
    )
  }

  /**
   * Applies a new order handed over by Motion's `Reorder`.
   *
   * Deliberately the same `reorderByIds` path as `moveBlock`, so a drag and a
   * button press cannot diverge: one ordering rule, one cap, one write.
   *
   * Guarded on identity rather than assumed equal. `onReorder` fires on every
   * frame the pointer crosses a neighbour, including frames where nothing actually
   * changed order, so writing unconditionally would push a document save on every
   * mousemove during a drag — a version bump per frame, which is both wasteful and
   * a way to manufacture the very conflicts the version check exists to catch.
   */
  const reorderBlocks = (next: VisualPageBlock[]): void => {
    const nextIds = next.map((block) => block.id)
    const currentIds = blocks.map((block) => block.id)
    if (nextIds.length !== currentIds.length) return
    if (nextIds.every((id, index) => id === currentIds[index])) return
    commitBlocks(
      reorderByIds(blocks, nextIds, (block) => block.id),
      `${pageType}-block-reorder`
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

  /**
   * One card, with the workspace's handlers bound to it.
   *
   * A thin wrapper on purpose: the card is a component in its own file because it
   * calls `useDragControls`, and a hook invoked from inside `blocks.map(...)` would
   * join *this* component's hook list — so adding a diagram would change the hook
   * count and break the page. See the note on `DiagramBlockCard`.
   */
  const blockCard = (block: VisualPageBlock, index: number): JSX.Element => (
    <DiagramBlockCard
      key={block.id}
      block={block}
      index={index}
      total={blocks.length}
      pageType={pageType}
      pageId={pageId}
      mermaidBlockType={MERMAID_BLOCK_TYPE}
      colorScheme={colorScheme}
      fit={fit}
      zoom={zoom}
      renderSeq={renderSeq}
      onResize={(blockId, width, height) => {
        commitBlocks(
          blocks.map((candidate) =>
            candidate.id === blockId ? { ...candidate, width, height } : candidate
          ),
          `${pageType}-block-resize`
        )
      }}
      onEdit={startEditing}
      onMove={moveBlock}
      onRemove={removeBlock}
    />
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
      pageTypeLabel={UI_TEXT.diagramPage}
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
          {/* No template bar here any more. It used to sit under this edit bar,
              reachable only by first adding a generic diagram and entering edit
              mode. It is now in the page's toolbar row, above the workspace and
              visible without entering edit mode, where choosing a template adds
              that diagram to the page. */}
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
          {/* View controls only. "Add diagram" used to sit here, on the left of
           * this bar, while the template chooser had already moved up into the
           * page toolbar — so the page's two creation actions were split across
           * two bars with the chooser above the page header and the button below
           * it. Both now live together in the toolbar row, and this bar holds
           * only what is genuinely about viewing the diagrams rather than making
           * them. */}
          <Group justify="flex-end" gap={4} wrap="nowrap" className={classes.viewBar}>
            {refreshButton}
            {fitToggle}
            {zoomControls}
            {fullscreenToggle}
          </Group>
          <div className={classes.contentRow}>
            <Reorder.Group
              as="div"
              // "xy" because this list **wraps**. Motion documents "x" for
              // horizontal rows, "y" for vertical columns and "xy" for grids and
              // wrapped layouts — which is precisely `flex-flow: row wrap` below.
              // A single axis cannot express "put this diagram to the left of that
              // one on the next row", and the installed types confirm the value
              // exists (`ReorderAxis = "x" | "y" | "xy"`).
              axis="xy"
              values={blocks}
              // Reordered through the same validated path the up/down buttons use,
              // so there is one persistence route and one cap, not two. Motion
              // hands back the whole new array; it is mapped by id rather than by
              // position, because position is exactly what just changed.
              onReorder={reorderBlocks}
              className={classes.blockList}
              data-testid={`${pageType}-block-list`}
            >
              {blocks.map((block, index) => blockCard(block, index))}
            </Reorder.Group>
            {sidebar}
          </div>
        </>
      )}
    </div>
  )
}
