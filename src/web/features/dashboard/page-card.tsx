import { ActionIcon, Card, Menu } from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { IconCopy, IconDots, IconTrash } from '@tabler/icons-react'
import { UI_TEXT } from '../../config/index.js'
import { debugLog } from '../../diagnostics/debug-log.js'
import { pagePreviewText } from '../../util/page-preview-text.js'
import classes from './page-card.module.css'

interface PageCardProps {
  page: Page
  onOpen: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
}

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleDateString()
  } catch {
    return value
  }
}

/**
 * Accessible page card.
 *
 * The open control is a REAL button containing the visible card content
 * (title, preview, meta) as styled spans — phrasing content only, so the
 * markup stays valid. The whole rendered surface is therefore genuinely
 * clickable in every browser and geometry, with native Enter/Space
 * activation and a visible focus outline. The three-dot menu is a sibling
 * interactive element, never nested inside the button.
 *
 * (The previous implementation used an absolutely-positioned transparent
 * overlay button; its inset-stretch collapsed to a 6px sliver in production
 * CSS, so real clicks on the card body silently did nothing.)
 */
export function PageCard({ page, onOpen, onDuplicate, onDelete }: PageCardProps): JSX.Element {
  const displayTitle = page.title || UI_TEXT.untitledPage

  return (
    <Card withBorder padding={0} radius="md" className={classes.card}>
      <button
        type="button"
        className={classes.cardOpen}
        onClick={() => {
          debugLog('ui', 'ui_card_open', { pageId: page.id })
          onOpen(page.id)
        }}
        aria-label={`Open ${displayTitle}`}
      >
        <span className={classes.cardTitle}>{displayTitle}</span>
        <span className={classes.cardPreview}>
          {pagePreviewText(page) || UI_TEXT.editorPlaceholderContent}
        </span>
        <span className={classes.cardMeta}>
          <span className={`${classes.cardType} ${classes[`type-${page.pageType}`]}`}>
            {page.pageType === 'rich' ? UI_TEXT.richNote : UI_TEXT.htmlPage}
          </span>
          <span>{formatDate(page.updatedAt)}</span>
        </span>
      </button>

      <div className={classes.cardMenuWrapper}>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              className={classes.cardMenuButton}
              aria-label={`Actions for ${displayTitle}`}
            >
              <IconDots size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => onDuplicate(page.id)}>
              {UI_TEXT.duplicateAction}
            </Menu.Item>
            <Menu.Item
              leftSection={<IconTrash size={14} />}
              color="red"
              onClick={() => onDelete(page.id)}
            >
              {UI_TEXT.deleteAction}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
    </Card>
  )
}
