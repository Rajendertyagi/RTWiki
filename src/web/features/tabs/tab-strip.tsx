import { ActionIcon } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
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

  return (
    <div className={classes.strip} role="tablist" aria-label={UI_TEXT.tabStripLabel}>
      <div className={classes.tabScroller}>
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
    </div>
  )
}
