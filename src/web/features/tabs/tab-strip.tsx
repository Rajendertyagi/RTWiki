import { ActionIcon, Tooltip } from '@mantine/core'
import { IconPlus, IconX } from '@tabler/icons-react'
import { UI_TEXT } from '../../config/index.js'
import classes from './tab-strip.module.css'
import type { OpenTab } from './tabs-model.js'

interface TabStripProps {
  tabs: OpenTab[]
  activePageId: string | null
  onSelect: (pageId: string) => void
  onClose: (pageId: string) => void
  onNew: () => void
}

/**
 * In-session document tabs. Session-only: tabs reference open pages and are
 * never persisted. Horizontal overflow scrolls instead of crushing content.
 */
export function TabStrip({
  tabs,
  activePageId,
  onSelect,
  onClose,
  onNew
}: TabStripProps): JSX.Element {
  return (
    <div className={classes.strip} role="tablist" aria-label={UI_TEXT.tabStripLabel}>
      <div className={classes.tabScroller}>
        {tabs.map((tab) => {
          const active = tab.pageId === activePageId
          return (
            <div
              key={tab.pageId}
              role="tab"
              tabIndex={0}
              aria-selected={active}
              className={active ? `${classes.tab} ${classes.tabActive}` : classes.tab}
              onClick={() => onSelect(tab.pageId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onSelect(tab.pageId)
                }
              }}
            >
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
      <Tooltip label={UI_TEXT.utilityRailNewPage} position="bottom">
        <ActionIcon
          variant="subtle"
          size="sm"
          className={classes.newButton}
          aria-label={UI_TEXT.utilityRailNewPage}
          onClick={onNew}
        >
          <IconPlus size={16} />
        </ActionIcon>
      </Tooltip>
    </div>
  )
}
