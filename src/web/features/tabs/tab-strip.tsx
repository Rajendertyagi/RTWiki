import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ActionIcon } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconX } from '@tabler/icons-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { PageTypeIcon } from '../../components/page-type-icon.js'
import { UI_TEXT } from '../../config/index.js'
import classes from './tab-strip.module.css'
import { moveInTabs, type OpenTab } from './tabs-model.js'

interface TabStripProps {
  tabs: OpenTab[]
  activePageId: string | null
  onSelect: (pageId: string) => void
  onClose: (pageId: string) => void
  /** Commits a new tab order. Supplied by the owner of the tab state. */
  onReorder: (orderedIds: string[]) => void
}

/** How far one chevron press moves the row. Matches Trilium's 210px. */
const SCROLL_STEP = 210

interface TabScrollButtonProps {
  direction: 'prev' | 'next'
  /** False when every tab already fits, so the chevron is not rendered at all. */
  overflow: boolean
  /** True when the row cannot move any further in this direction. */
  disabled: boolean
  onClick: () => void
}

/**
 * The affordance for a tab row that is wider than the window.
 *
 * The row scrolls and its scrollbar is hidden, so without this the extra tabs
 * are simply invisible with nothing to suggest they exist. The chevrons only
 * appear when there is something to reveal, and grey out at each end.
 */
function TabScrollButton({
  direction,
  overflow,
  disabled,
  onClick
}: TabScrollButtonProps): JSX.Element | null {
  if (!overflow) return null
  return (
    <ActionIcon
      variant="subtle"
      size="sm"
      className={classes.scrollButton}
      data-testid={direction === 'prev' ? 'tab-scroll-prev' : 'tab-scroll-next'}
      data-direction={direction}
      aria-label={
        direction === 'prev' ? UI_TEXT.tabsScrollBackLabel : UI_TEXT.tabsScrollForwardLabel
      }
      disabled={disabled}
      onClick={onClick}
    >
      {direction === 'prev' ? <IconChevronLeft size={16} /> : <IconChevronRight size={16} />}
    </ActionIcon>
  )
}

/**
 * Tracks whether the tab row overflows and where its scroll edges are.
 *
 * Measured rather than breakpoint-driven, so the chevrons appear at the width
 * the content actually needs rather than at a guessed breakpoint. The scroll
 * listener is what keeps the disabled state honest after a wheel, trackpad or
 * programmatic scroll.
 */
function useTabOverflow(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  // Read only through the effect's dependency list; see the note there.
  tabCount: number
): { overflow: boolean; atStart: boolean; atEnd: boolean } {
  const [state, setState] = useState({ overflow: false, atStart: true, atEnd: true })

  const measure = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const overflow = max > 1
    setState({
      overflow,
      atStart: el.scrollLeft <= 1,
      atEnd: el.scrollLeft >= max - 1
    })
  }, [scrollerRef])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tabCount` is a re-run trigger, not a reference — see the note at the dependency list.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    for (const child of Array.from(el.children)) observer.observe(child)
    el.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', measure)
    }
  }, [measure, scrollerRef, tabCount])

  return state
}

interface TabItemProps {
  tab: OpenTab
  active: boolean
  onSelect: (pageId: string) => void
  onClose: (pageId: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
}

/**
 * One tab item using `@dnd-kit/sortable`.
 *
 * Styled without top accent colors or bottom borders, and merges seamlessly
 * with the workspace below when active.
 *
 * The drag handle overlay covers the whole tab so dragging can start anywhere,
 * while the close button sits at higher z-index on the far right.
 */
function TabItem({ tab, active, onSelect, onClose, onKeyDown }: TabItemProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.pageId
  })

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? undefined,
    zIndex: isDragging ? 100 : active ? 3 : 1
  }

  const tabClass = [
    classes.tab,
    active ? classes.tabActive : '',
    isDragging ? classes.tabDragging : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={setNodeRef}
      style={style}
      id={`tab-${tab.pageId}`}
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      className={tabClass}
      onClick={() => onSelect(tab.pageId)}
      onAuxClick={(event) => {
        // Middle click closes tab
        if (event.button === 1) {
          event.preventDefault()
          onClose(tab.pageId)
        }
      }}
      onKeyDown={onKeyDown}
      data-page-id={tab.pageId}
      data-dragging={isDragging ? 'true' : 'false'}
    >
      {/*
        Drag handle overlay: hooks up dnd-kit listeners and attributes,
        letting a drag start anywhere across the tab while remaining separate
        from the close button.
      */}
      <div
        className={classes.tabDragHandle}
        data-testid={`tab-drag-handle-${tab.pageId}`}
        {...attributes}
        {...listeners}
      />
      <span className={classes.tabTypeIcon}>
        <PageTypeIcon pageType={tab.pageType} size={14} />
      </span>
      <span className={classes.tabTitle}>{tab.title}</span>
      <ActionIcon
        variant="subtle"
        size="sm"
        className={classes.tabClose}
        aria-label={`${UI_TEXT.tabCloseLabel}: ${tab.title}`}
        onClick={(event) => {
          event.stopPropagation()
          onClose(tab.pageId)
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <IconX size={15} />
      </ActionIcon>
    </div>
  )
}

/**
 * In-session document tabs powered by @dnd-kit.
 *
 * Session-only: tabs reference open pages and are never persisted.
 * Horizontal overflow scrolls cleanly with chevrons.
 *
 * Tabs reorder by drag-and-drop and by Ctrl+Arrow for keyboard users, both
 * flowing through `moveInTabs` to guarantee single-source-of-truth ordering.
 */
export function TabStrip({
  tabs,
  activePageId,
  onSelect,
  onClose,
  onReorder
}: TabStripProps): JSX.Element {
  // Announced after a keyboard reorder, so a screen reader hears the new position.
  const [announcement, setAnnouncement] = useState('')
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)
  const liveId = useId()

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  useEffect(() => {
    if (pendingFocusId === null) return
    const el = document.getElementById(`tab-${pendingFocusId}`)
    el?.focus()
    setPendingFocusId(null)
  }, [pendingFocusId])

  const tabIds = useMemo(() => tabs.map((t) => t.pageId), [tabs])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      const fromIndex = tabIds.indexOf(String(active.id))
      const toIndex = tabIds.indexOf(String(over.id))
      if (fromIndex === -1 || toIndex === -1) return

      const reordered = moveInTabs(tabs, fromIndex, toIndex)
      if (reordered !== tabs) {
        onReorder(reordered.map((t) => t.pageId))
      }
    },
    [tabs, tabIds, onReorder]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, currentIndex: number): void => {
      if (tabs.length === 0) return
      const currentTab = tabs[currentIndex]
      if (!currentTab) return

      const wantsMove = event.ctrlKey
      const isForward = event.key === 'ArrowRight'
      const isBack = event.key === 'ArrowLeft'

      if ((isForward || isBack) && wantsMove) {
        event.preventDefault()
        const target = currentIndex + (isForward ? 1 : -1)
        if (target < 0 || target > tabs.length - 1) return
        const reordered = moveInTabs(tabs, currentIndex, target)
        if (reordered !== tabs) {
          onReorder(reordered.map((t) => t.pageId))
          setAnnouncement(`${currentTab.title}, moved to position ${target + 1} of ${tabs.length}`)
          setPendingFocusId(currentTab.pageId)
        }
        return
      }

      if (isForward) {
        event.preventDefault()
        const nextTab = tabs[(currentIndex + 1) % tabs.length]
        if (nextTab) onSelect(nextTab.pageId)
      } else if (isBack) {
        event.preventDefault()
        const prevTab = tabs[(currentIndex - 1 + tabs.length) % tabs.length]
        if (prevTab) onSelect(prevTab.pageId)
      } else if (event.key === 'Home') {
        event.preventDefault()
        const firstTab = tabs[0]
        if (firstTab) onSelect(firstTab.pageId)
      } else if (event.key === 'End') {
        event.preventDefault()
        const lastTab = tabs[tabs.length - 1]
        if (lastTab) onSelect(lastTab.pageId)
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onSelect(currentTab.pageId)
      }
    },
    [tabs, onSelect, onReorder]
  )

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const { overflow, atStart, atEnd } = useTabOverflow(scrollerRef, tabs.length)

  const scrollBy = useCallback((direction: 1 | -1) => {
    scrollerRef.current?.scrollBy({ left: direction * SCROLL_STEP, behavior: 'smooth' })
  }, [])

  return (
    <div className={classes.strip} role="presentation">
      <TabScrollButton
        direction="prev"
        overflow={overflow}
        disabled={atStart}
        onClick={scrollBy.bind(null, -1)}
      />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={handleDragEnd}
      >
        <div
          role="tablist"
          aria-label={UI_TEXT.tabStripLabel}
          className={classes.tabScroller}
          ref={scrollerRef}
          data-testid="tab-scroll-container"
        >
          <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
            {tabs.map((tab, index) => {
              const active = tab.pageId === activePageId
              return (
                <TabItem
                  key={tab.pageId}
                  tab={tab}
                  active={active}
                  onSelect={onSelect}
                  onClose={onClose}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                />
              )
            })}
          </SortableContext>
        </div>
      </DndContext>
      <TabScrollButton
        direction="next"
        overflow={overflow}
        disabled={atEnd}
        onClick={scrollBy.bind(null, 1)}
      />
      <span
        id={liveId}
        role="status"
        aria-live="polite"
        data-testid="tab-reorder-announcer"
        className={classes.tabAnnouncer}
      >
        {announcement}
      </span>
    </div>
  )
}
