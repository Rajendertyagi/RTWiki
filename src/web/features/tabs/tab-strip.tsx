import { ActionIcon } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconX } from '@tabler/icons-react'
import { Reorder, useDragControls } from 'motion/react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { PageTypeIcon } from '../../components/page-type-icon.js'
import { UI_TEXT } from '../../config/index.js'
import classes from './tab-strip.module.css'
import type { OpenTab } from './tabs-model.js'

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
    // `tabCount` is deliberate and the exhaustive-deps rule is wrong here.
    // The ResizeObserver watches the scroller (whose border box never changes,
    // it is `flex: 1`) and the children that exist when the effect runs. A
    // *newly added* tab therefore fires nothing, yet it changes `scrollWidth`
    // and can make the row overflow, so the chevrons must re-measure. Removing
    // this dependency leaves the chevrons stale after opening a page.
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
 * One tab.
 *
 * Split out so it can hold the `useDragControls` hook, which is per-tab. The
 * hook is what lets the drag start from a handle rather than from the whole
 * element: `dragListener={false}` disables Motion's own pointer listener, and
 * the overlay below calls `controls.start` instead.
 *
 * The handle is an absolutely positioned overlay covering the tab, the same
 * arrangement Trilium uses, with the close button stacked above it. That is why
 * a drag can begin anywhere on the tab and the × still closes it: the two never
 * compete for the same pixels, and the × is not part of the handle.
 */
function TabItem({ tab, active, onSelect, onClose, onKeyDown }: TabItemProps): JSX.Element {
  const controls = useDragControls()
  return (
    <Reorder.Item
      as="div"
      value={tab}
      // Required by the tablist contract, and all of it verified to reach the
      // DOM through Reorder.Item rather than being swallowed by it.
      id={`tab-${tab.pageId}`}
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      className={active ? `${classes.tab} ${classes.tabActive}` : classes.tab}
      dragListener={false}
      dragControls={controls}
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
    >
      <div
        className={classes.tabDragHandle}
        data-testid={`tab-drag-handle-${tab.pageId}`}
        onPointerDown={(event) => controls.start(event)}
      />
      <span className={classes.tabTypeIcon}>
        <PageTypeIcon pageType={tab.pageType} size={14} />
      </span>
      <span className={classes.tabTitle}>{tab.title}</span>
      <ActionIcon
        variant="subtle"
        size="xs"
        className={classes.tabClose}
        aria-label={`${UI_TEXT.tabCloseLabel}: ${tab.title}`}
        onClick={(event) => {
          event.stopPropagation()
          onClose(tab.pageId)
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <IconX size={12} />
      </ActionIcon>
    </Reorder.Item>
  )
}

/**
 * In-session document tabs. Session-only: tabs reference open pages and are
 * never persisted. Horizontal overflow scrolls instead of crushing content.
 * Compact and consistent: a small page-type icon, the truncated title, and a
 * close control. The separate "new page" affordance lives in the launcher
 * rail, so no `+` button is rendered here.
 *
 * Tabs reorder by dragging, and by Ctrl+Arrow for the keyboard. Both paths go
 * through the same model function, so they cannot disagree.
 */
export function TabStrip({
  tabs,
  activePageId,
  onSelect,
  onClose,
  onReorder
}: TabStripProps): JSX.Element {
  // Announced after a keyboard reorder, so a screen reader hears the new
  // position. A polite live region: it must not interrupt, and it must persist
  // long enough to be read, so the same text is not re-announced on re-render.
  const [announcement, setAnnouncement] = useState('')
  // The tab that should hold focus once the reorder has rendered.
  //
  // Focus has to travel with the tab that moved, or the next keypress lands on
  // whatever slid into its old slot. It is done in an effect rather than in a
  // `requestAnimationFrame` callback because the reorder re-renders the row:
  // inside a frame callback the element can still be the outgoing one, and the
  // focus call silently lands on a detached node.
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)
  const liveId = useId()

  useEffect(() => {
    if (pendingFocusId === null) return
    const el = document.getElementById(`tab-${pendingFocusId}`)
    el?.focus()
    setPendingFocusId(null)
    // No `tabs`: the tab's id and React key are both its page id, so the row is
    // the same DOM node before and after the reorder. The effect only has to
    // wait for the commit that `pendingFocusId` itself triggered.
  }, [pendingFocusId])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, currentIndex: number): void => {
      if (tabs.length === 0) return
      const currentTab = tabs[currentIndex]
      if (!currentTab) return

      // Ctrl+Arrow *moves* the tab; a bare Arrow still just switches. The
      // modifier is what separates rearranging from navigating, and both are
      // kept because neither replaces the other.
      const wantsMove = event.ctrlKey
      const isForward = event.key === 'ArrowRight'
      const isBack = event.key === 'ArrowLeft'

      if ((isForward || isBack) && wantsMove) {
        event.preventDefault()
        const target = currentIndex + (isForward ? 1 : -1)
        // Stop at the ends rather than wrapping: wrapping would silently send
        // a tab from first to last, which is never what was meant.
        if (target < 0 || target > tabs.length - 1) return
        const orderedIds = tabs.map((t) => t.pageId)
        const [movedId] = orderedIds.splice(currentIndex, 1)
        if (!movedId) return
        orderedIds.splice(target, 0, movedId)
        onReorder(orderedIds)
        setAnnouncement(`${currentTab.title}, moved to position ${target + 1} of ${tabs.length}`)
        setPendingFocusId(movedId)
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
      <Reorder.Group
        as="div"
        axis="x"
        values={tabs}
        onReorder={(next) => onReorder(next.map((tab) => tab.pageId))}
        // The tablist semantics live here. The group is the tablist and each
        // item is a tab, so `role` moves off the wrapper the strip used to be.
        role="tablist"
        aria-label={UI_TEXT.tabStripLabel}
        className={classes.tabScroller}
        ref={scrollerRef}
        data-testid="tab-scroll-container"
      >
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
      </Reorder.Group>
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
