import { createReactBlockSpec } from '@blocknote/react'
import { ActionIcon, Box, Button, Group, Select, Text, Tooltip } from '@mantine/core'
import type { PageType } from '@rtwiki/shared/contracts/pages'
import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconLink,
  IconRefresh,
  IconTrash
} from '@tabler/icons-react'
import { createContext, useContext } from 'react'
import { PageTypeIcon } from '../../../components/page-type-icon.js'
import { LAYOUT, UI_TEXT } from '../../../config/index.js'
import type { LinkablePage } from '../wiki-link.js'
import classes from './linked-page.module.css'

/** A page resolved for card display. */
export interface ResolvedLinkedPage {
  id: string
  title: string
  pageType: PageType
  preview: string
}

/**
 * Shares the living page list and the open-page action with linked-page blocks.
 * Provided by the Rich Editor around the BlockNote view so node views can
 * resolve targets and navigate without prop drilling through BlockNote.
 */
export interface LinkedPageContextValue {
  pages: LinkablePage[]
  resolvePage: (id: string) => ResolvedLinkedPage | null
  openPage: (id: string) => void
}

export const LinkedPageContext = createContext<LinkedPageContextValue | null>(null)

export function useLinkedPageContext(): LinkedPageContextValue | null {
  return useContext(LinkedPageContext)
}

/**
 * Rich "linked page" block: a card that points at an existing RTWiki page.
 *
 * The stored prop is only the target page ID — no title or preview is
 * duplicated, so the card always reflects the live page. A missing target
 * (deleted page) keeps the stored ID and shows a recoverable state instead of
 * losing the link. Clicking opens the page through RTWiki's normal tab/nav
 * flow; it never triggers browser navigation.
 */
export const createReactLinkedPageSpec = () =>
  createReactBlockSpec(
    {
      type: 'linkedPage',
      propSchema: {
        targetId: { default: '' }
      },
      // 'plain' mirrors the diagram block: the block keeps an (empty, hidden)
      // text host so BlockNote can attach content, while the visible UI is the
      // linked-page card.
      content: 'plain'
    },
    {
      render: ({ block, editor, contentRef }) => {
        const ctx = useLinkedPageContext()
        const targetId = (block.props.targetId as string) ?? ''

        const removeSelf = (): void => {
          try {
            editor.removeBlocks([block as never])
          } catch {
            editor.updateBlock(block as never, { props: { targetId: '' } } as never)
          }
        }

        const changeTarget = (): void => {
          editor.updateBlock(block as never, { props: { targetId: '' } } as never)
        }

        // No target yet: show a searchable picker to choose a page.
        if (!targetId) {
          const options = (ctx?.pages ?? []).map((p) => ({
            value: p.id,
            label: p.title || UI_TEXT.untitledPage
          }))
          return (
            <Box className={classes.picker} data-testid="linked-page-picker">
              <div ref={contentRef} className={classes.hiddenHost} aria-hidden="true" />
              <Select
                searchable
                nothingFoundMessage={UI_TEXT.wikiLinkEmptyLabel}
                placeholder={UI_TEXT.linkedPagePickLabel}
                data={options}
                comboboxProps={{ withinPortal: true, zIndex: LAYOUT.overlayZIndex }}
                leftSection={<IconLink size={14} />}
                onChange={(value) => {
                  if (value) {
                    editor.updateBlock(block as never, { props: { targetId: value } } as never)
                  }
                }}
                data-testid="linked-page-select"
                aria-label={UI_TEXT.linkedPagePickLabel}
              />
            </Box>
          )
        }

        const resolved = ctx?.resolvePage(targetId) ?? null

        // Target no longer exists: keep the ID, offer recovery.
        if (!resolved) {
          return (
            <div
              className={`${classes.card} ${classes.broken}`}
              data-testid="linked-page-broken"
              role="alert"
            >
              <div ref={contentRef} className={classes.hiddenHost} aria-hidden="true" />
              <Box className={classes.cardIcon}>
                <IconAlertTriangle size={16} />
              </Box>
              <Box className={classes.cardBody}>
                <Text size="sm" className={classes.brokenText}>
                  {UI_TEXT.linkedPageMissingLabel}
                </Text>
                <Text size="xs" c="dimmed">
                  {targetId}
                </Text>
              </Box>
              <Group gap={2} className={classes.cardActions}>
                <Tooltip label={UI_TEXT.linkedPageChangeLabel} position="top">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    aria-label={UI_TEXT.linkedPageChangeLabel}
                    onClick={changeTarget}
                    data-testid="linked-page-change"
                  >
                    <IconRefresh size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={UI_TEXT.linkedPageRemoveLabel} position="top">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    aria-label={UI_TEXT.linkedPageRemoveLabel}
                    onClick={removeSelf}
                    data-testid="linked-page-remove"
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </div>
          )
        }

        return (
          <div className={classes.card} data-testid="linked-page-card">
            <div ref={contentRef} className={classes.hiddenHost} aria-hidden="true" />
            <Box className={classes.cardIcon} aria-hidden="true">
              <PageTypeIcon pageType={resolved.pageType} size={16} />
            </Box>
            <Box className={classes.cardBody}>
              <div className={classes.cardTitle} title={resolved.title}>
                {resolved.title || UI_TEXT.untitledPage}
              </div>
              {resolved.preview ? (
                <div className={classes.cardPreview}>{resolved.preview}</div>
              ) : null}
            </Box>
            <Group gap={2} className={classes.cardActions}>
              <Button
                size="compact-xs"
                variant="light"
                leftSection={<IconArrowUpRight size={14} />}
                onClick={() => ctx?.openPage(resolved.id)}
                data-testid="linked-page-open"
              >
                {UI_TEXT.openLabel}
              </Button>
              <Tooltip label={UI_TEXT.linkedPageChangeLabel} position="top">
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  aria-label={UI_TEXT.linkedPageChangeLabel}
                  onClick={changeTarget}
                  data-testid="linked-page-change"
                >
                  <IconRefresh size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={UI_TEXT.linkedPageRemoveLabel} position="top">
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  aria-label={UI_TEXT.linkedPageRemoveLabel}
                  onClick={removeSelf}
                  data-testid="linked-page-remove"
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </div>
        )
      }
    }
  )
