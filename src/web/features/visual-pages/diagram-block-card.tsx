import { ActionIcon, Group, Text, Tooltip } from '@mantine/core'
import type { VisualPageBlock } from '@rtwiki/shared/schemas/visual-page-content'
import {
  IconChevronDown,
  IconChevronUp,
  IconGripVertical,
  IconPencil,
  IconTrash
} from '@tabler/icons-react'
import { Reorder, useDragControls } from 'motion/react'
import type { JSX } from 'react'
import { useRef } from 'react'
import { UI_TEXT } from '../../config/index.js'
import type { CSSVars } from '../../style-props.js'
import { ResizableBlockContainer } from '../rich-editor/blocks/block-resize.js'
import { DiagramView } from '../rich-editor/blocks/diagram-view.js'
import { DiagramCanvas } from './diagram-canvas.js'
import classes from './mermaid-workspace.module.css'

/**
 * One diagram on the Diagram page: a reorderable, resizable card.
 *
 * ## Why this is a component and not a function in the workspace
 *
 * It calls `useDragControls`. That hook has to belong to a component, and the first
 * version of this card was a plain function invoked from `blocks.map(...)`, which
 * put the hook **inside the workspace's** hook list. The count then changed with the
 * number of blocks, so adding a diagram produced a different number of hooks than
 * the previous render — and the page stopped working: adding a diagram did nothing,
 * and `diagram-templates.pwspec.ts` lost five tests. The failure looked like a
 * broken template picker, which is how it was found.
 *
 * Extracting it is the fix and is the rule: a hook called in a loop is not a hook.
 *
 * The card is draggable **from a grip**, not from its whole surface. `dragListener`
 * is off on the item and the grip opts back in, because this card also holds a
 * corner resize handle, a Mermaid canvas that pans and zooms, and a row of action
 * buttons. A card-wide drag listener would fight all three — starting a reorder
 * when the user meant to resize, or swallowing a click on "delete".
 */
export interface DiagramBlockCardProps {
  block: VisualPageBlock
  /** Position in the page's block list, used for testids and the visible label. */
  index: number
  total: number
  pageType: 'diagram'
  pageId: string
  mermaidBlockType: 'diagram' | 'mindMap'
  colorScheme: string
  fit: boolean
  zoom: number
  renderSeq: number
  /** Persists a new stored size for this block. */
  onResize: (blockId: string, width: string, height: string) => void
  onEdit: (index: number) => void
  onMove: (index: number, delta: -1 | 1) => void
  onRemove: (index: number) => void
}

const blockLabel = (position: number, total: number): string =>
  UI_TEXT.diagramBlockLabel
    .replace('{position}', String(position))
    .replace('{total}', String(total))

export function DiagramBlockCard({
  block,
  index,
  total,
  pageType,
  pageId,
  mermaidBlockType,
  colorScheme,
  fit,
  zoom,
  renderSeq,
  onResize,
  onEdit,
  onMove,
  onRemove
}: DiagramBlockCardProps): JSX.Element {
  const controls = useDragControls()
  const width = block.width ?? ''
  const height = block.height ?? ''

  // The item is the element Motion transforms, and the element the resize container
  // must paint the in-flight size onto: it is capped to `max-width: 100%` of this
  // item, so without the item moving a horizontal drag cannot leave its column.
  // A ref rather than state, because a `setState` per `pointermove` re-rendered the
  // whole workspace — every Mermaid canvas included — and the box lagged the pointer.
  const itemRef = useRef<HTMLDivElement | null>(null)

  return (
    <Reorder.Item
      as="div"
      // Keyed by the block's own id, not by its position. Without this React
      // reconciles the list by index, so a diagram added in the middle would reuse
      // the previous neighbour's `DiagramCanvas` — and with it that component's
      // already-rendered SVG — showing one diagram twice and another not at all.
      key={block.id}
      value={block}
      // The resize container writes the in-flight size straight onto this element
      // during a drag, and this ref is the only thing that lets it. Without the ref
      // the container has nowhere to publish to, and the drag silently does nothing
      // horizontally: measured, the box sat at 481px for all eight samples of a 160px
      // drag and snapped to size only on release. `Reorder.Item` forwards a ref to its
      // DOM node (framer-motion 13.4.4, `ReorderItemComponent(..., externalRef)`).
      ref={itemRef}
      // The stored size lives on the **reorder item**, not on the resize container
      // inside it, because this is the element Motion transforms while dragging.
      // Sizing a child of a transformed element would scale the child along with the
      // drag. `data-width` is what the layout CSS keys on to decide whether a block
      // keeps a user-chosen size or takes a share of the row.
      data-width={width}
      data-height={height}
      // `data-live` is set and removed by the resize container, not here: it marks the
      // window during which this item is being dragged, and the layout drops the
      // row-sharing flex rules for it so the item can take the dragged width instead
      // of its share. Keeping it out of React is the point — see `itemRef`.
      //
      // The stored size is published as a **custom property** so the container
      // inherits it and no selector has to win a specificity fight over the shared
      // component's own rule. Absent when the block is unsized, and then the flex
      // rules alone decide the width — `width: auto` on a block-level child fills
      // its parent, which is the layout that was already working.
      //
      // Custom properties rather than `width`/`height` because the repo forbids an
      // inline layout property in a `style={{}}` (`tests/theme-registry.test.ts`).
      style={
        {
          '--block-width': width || undefined,
          '--block-height': height || undefined
        } as CSSVars
      }
      dragListener={false}
      dragControls={controls}
      className={classes.blockListItem}
      data-testid={`${pageType}-block-item-${index}`}
    >
      <ResizableBlockContainer
        width={width}
        height={height}
        onCommit={(nextWidth, nextHeight) => onResize(block.id, nextWidth, nextHeight)}
        liveStyleTarget={itemRef}
        testIdPrefix={`${pageType}-block-${index}`}
      >
        <section
          className={classes.blockCard}
          aria-label={blockLabel(index + 1, total)}
          data-testid={`${pageType}-block-${index}`}
        >
          <Group justify="space-between" wrap="nowrap" gap="xs" className={classes.blockBar}>
            <Group gap={2} wrap="nowrap" className={classes.blockBarStart}>
              <Tooltip label={UI_TEXT.diagramDragBlockLabel}>
                <button
                  type="button"
                  className={classes.blockDragHandle}
                  aria-label={UI_TEXT.diagramDragBlockLabel}
                  data-testid={`${pageType}-block-drag-${index}`}
                  onPointerDown={(event) => controls.start(event)}
                >
                  <IconGripVertical size={14} />
                </button>
              </Tooltip>
              <Text size="xs" c="dimmed" data-testid={`${pageType}-block-title-${index}`}>
                {blockLabel(index + 1, total)}
              </Text>
            </Group>
            <Group gap={2} wrap="nowrap">
              <Tooltip label={UI_TEXT.diagramEditBlockLabel}>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  aria-label={UI_TEXT.diagramEditBlockLabel}
                  onClick={() => onEdit(index)}
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
                  // The first block cannot move up, so the control says so rather
                  // than doing nothing when pressed. These buttons remain after
                  // pointer dragging exists: a drag needs a pointer, and these are
                  // focusable, labelled and reachable by Tab.
                  disabled={index === 0}
                  onClick={() => onMove(index, -1)}
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
                  disabled={index === total - 1}
                  onClick={() => onMove(index, 1)}
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
                  disabled={total <= 1}
                  onClick={() => onRemove(index)}
                  data-testid={`${pageType}-block-remove-${index}`}
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
          {/* The view controls wrap the *canvas* rather than sitting inside it, so
           * that `[data-testid="diagram-rendered"] svg` still resolves to exactly one
           * element: the controls are inline SVG icons, and inside the canvas that
           * selector matched nine — the diagram plus eight icons — which broke every
           * test that reaches for the diagram by that path. */}
          <DiagramView testIdPrefix={`${pageType}-block-${index}`}>
            <div
              // **Both** classes when a height is stored: `.blockCanvasSized` only adds
              // the scale-to-fit rules, while `.blockCanvas` still supplies the flex
              // column and the padding. An earlier version applied `blockCanvasSized`
              // *instead of* `blockCanvas`, which quietly cost the canvas
              // `display: flex` and `flex: 1` — so its height went back to being
              // content-driven and the diagram overflowed its box by 6.77px. Measured
              // in the browser; the two classes are not interchangeable.
              className={`${classes.blockCanvas}${height === '' ? '' : ` ${classes.blockCanvasSized}`}`}
              data-testid={`${pageType}-rendered`}
              data-sized={height === '' ? undefined : 'true'}
            >
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
          </DiagramView>
        </section>
      </ResizableBlockContainer>
    </Reorder.Item>
  )
}
