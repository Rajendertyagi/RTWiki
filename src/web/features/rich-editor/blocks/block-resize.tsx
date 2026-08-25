import { ActionIcon, Tooltip } from '@mantine/core'
import { IconResize } from '@tabler/icons-react'
import type { JSX, ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import { useRef, useState } from 'react'
import {
  BLOCK_SIZE_PRESETS,
  type BlockSizePresetKey,
  LAYOUT,
  UI_TEXT
} from '../../../config/index.js'
import classes from './mermaid-block.module.css'

/**
 * Resizable container for embedded Diagram / Mind Map blocks.
 *
 * Dimensions persist as typed block props (`width`/`height`, pixel strings,
 * '' = auto) so reload and duplicate preserve them without any migration.
 * Pointer dragging resizes width and height independently from a corner
 * handle; keyboard users get the always-rendered size-preset buttons.
 *
 * Clamps: min/max constants bound both axes, dragging clamps against the
 * parent width, and CSS max-width:100% re-clamps responsively on narrow
 * screens WITHOUT touching the stored desktop size. Zoom/Fit of the rendered
 * SVG stays independent — this container only bounds the box around it.
 */

export interface ResizableBlockContainerProps {
  /** Stored width prop: pixel number as a string, or '' for auto (100%). */
  width: string
  /** Stored height prop: pixel number as a string, or '' for auto. */
  height: string
  /** Persists a new size through editor.updateBlock (props-preserving). */
  onCommit: (width: string, height: string) => void
  testIdPrefix: string
  children: ReactNode
}

function parsePx(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function clampWidth(width: number, maxWidth: number): number {
  return Math.min(
    Math.max(width, LAYOUT.blockMinWidth),
    Math.max(LAYOUT.blockMinWidth, Math.min(LAYOUT.blockMaxWidth, maxWidth))
  )
}

export function clampHeight(height: number): number {
  return Math.min(Math.max(height, LAYOUT.blockMinHeight), LAYOUT.blockMaxHeight)
}

export function ResizableBlockContainer({
  width,
  height,
  onCommit,
  testIdPrefix,
  children
}: ResizableBlockContainerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragOriginRef = useRef<{
    pointerX: number
    pointerY: number
    startWidth: number
    startHeight: number
    maxWidth: number
  } | null>(null)
  const [dragSize, setDragSize] = useState<{ width: number; height: number } | null>(null)

  const storedWidth = parsePx(width)
  const storedHeight = parsePx(height)
  const activeWidth = dragSize?.width ?? storedWidth
  const activeHeight = dragSize?.height ?? storedHeight

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const container = containerRef.current
    if (container === null) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = container.getBoundingClientRect()
    const parent = container.parentElement
    dragOriginRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      // Never let the dragged width exceed the document column.
      maxWidth: (parent?.clientWidth ?? rect.width) - 2
    }
    setDragSize({ width: rect.width, height: rect.height })
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const origin = dragOriginRef.current
    if (origin === null) return
    setDragSize({
      width: clampWidth(origin.startWidth + (event.clientX - origin.pointerX), origin.maxWidth),
      height: clampHeight(origin.startHeight + (event.clientY - origin.pointerY))
    })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (dragOriginRef.current === null) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragOriginRef.current = null
    if (dragSize !== null) {
      onCommit(String(Math.round(dragSize.width)), String(Math.round(dragSize.height)))
    }
    setDragSize(null)
  }

  const applyPreset = (key: BlockSizePresetKey): void => {
    const preset = BLOCK_SIZE_PRESETS[key]
    const parentWidth = containerRef.current?.parentElement?.clientWidth ?? LAYOUT.blockMaxWidth
    const nextWidth = preset.width === 0 ? '' : String(clampWidth(preset.width, parentWidth))
    const nextHeight = preset.height === 0 ? '' : String(clampHeight(preset.height))
    onCommit(nextWidth, nextHeight)
  }

  return (
    <div
      ref={containerRef}
      className={classes.sizeContainer}
      style={{
        width: activeWidth !== null ? `${activeWidth}px` : undefined,
        height: activeHeight !== null ? `${activeHeight}px` : undefined
      }}
      data-testid={`${testIdPrefix}-container`}
      data-width={activeWidth ?? ''}
      data-height={activeHeight ?? ''}
    >
      {children}
      <div className={classes.sizePresets} role="toolbar" aria-label={UI_TEXT.sizePresetLabel}>
        {(Object.keys(BLOCK_SIZE_PRESETS) as BlockSizePresetKey[]).map((key) => (
          <Tooltip key={key} label={BLOCK_SIZE_PRESETS[key].label} position="top">
            <ActionIcon
              size="compact-xs"
              variant="subtle"
              aria-label={`${UI_TEXT.sizePresetLabel}: ${BLOCK_SIZE_PRESETS[key].label}`}
              data-testid={`${testIdPrefix}-preset-${key}`}
              onClick={() => applyPreset(key)}
            >
              {BLOCK_SIZE_PRESETS[key].label.charAt(0)}
            </ActionIcon>
          </Tooltip>
        ))}
      </div>
      <Tooltip label={UI_TEXT.resizeHandleLabel} position="top">
        <button
          type="button"
          className={classes.resizeHandle}
          aria-label={UI_TEXT.resizeHandleLabel}
          data-testid={`${testIdPrefix}-resize-handle`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={(event) => {
            // Keyboard-equivalent resizing in 40px steps.
            const step = 40
            const current = {
              width: activeWidth ?? LAYOUT.blockMinWidth,
              height: activeHeight ?? LAYOUT.blockMinHeight
            }
            const parentWidth =
              containerRef.current?.parentElement?.clientWidth ?? LAYOUT.blockMaxWidth
            if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
              event.preventDefault()
              onCommit(
                String(clampWidth(current.width + step, parentWidth)),
                String(clampHeight(current.height + step))
              )
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
              event.preventDefault()
              onCommit(
                String(clampWidth(current.width - step, parentWidth)),
                String(clampHeight(current.height - step))
              )
            }
          }}
        >
          <IconResize size={12} />
        </button>
      </Tooltip>
    </div>
  )
}
