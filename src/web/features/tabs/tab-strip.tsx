import { ActionIcon } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconX } from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PageTypeIcon } from '../../components/page-type-icon.js'
import { UI_TEXT } from '../../config/index.js'
import classes from './tab-strip.module.css'
import type { OpenTab } from './tabs-model.js'

interface TabStripProps {
  tabs: OpenTab[]
  activePageId: string | null
  onSelect: (pageId: string) => void
  onClose: (pageId: string) => void
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
  }, [measure, scrollerRef, tabCount])

  return state
}

/**
 * In-session document tabs. Session-only: tabs reference open pages and are
 * never persisted. Horizontal overflow scrolls instead of crushing content.
 * Compact and consistent: a small page-type icon, the truncated title, and a
 * close control. The separate "new page" affordance lives in the launcher
 * rail, so no `+` button is rendered here.
 */
export function TabStrip({ tabs, activePageId, onSelect, onClose }: TabStripProps): JSX.Element {
  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    currentIndex: number
  ): void => {
    if (tabs.length === 0) return

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      const nextIndex = (currentIndex + 1) % tabs.length
      const nextTab = tabs[nextIndex]
      if (nextTab) onSelect(nextTab.pageId)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length
      const prevTab = tabs[prevIndex]
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
      const currentTab = tabs[currentIndex]
      if (currentTab) onSelect(currentTab.pageId)
    }
  }

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const { overflow, atStart, atEnd } = useTabOverflow(scrollerRef, tabs.length)

  const scrollBy = useCallback((direction: 1 | -1) => {
    scrollerRef.current?.scrollBy({ left: direction * SCROLL_STEP, behavior: 'smooth' })
  }, [])

  return (
    <div className={classes.strip} role="tablist" aria-label={UI_TEXT.tabStripLabel}>
      <TabScrollButton
        direction="prev"
        overflow={overflow}
        disabled={atStart}
        onClick={scrollBy.bind(null, -1)}
      />
      <div className={classes.tabScroller} ref={scrollerRef} data-testid="tab-scroll-container">
        {tabs.map((tab, index) => {
          const active = tab.pageId === activePageId
          return (
            <div
              key={tab.pageId}
              role="tab"
              tabIndex={active ? 0 : -1}
              aria-selected={active}
              className={active ? `${classes.tab} ${classes.tabActive}` : classes.tab}
              onClick={() => onSelect(tab.pageId)}
              onAuxClick={(event) => {
                // Middle click closes tab
                if (event.button === 1) {
                  event.preventDefault()
                  onClose(tab.pageId)
                }
              }}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
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
            </div>
          )
        })}
      </div>
      <TabScrollButton
        direction="next"
        overflow={overflow}
        disabled={atEnd}
        onClick={scrollBy.bind(null, 1)}
      />
    </div>
  )
}
