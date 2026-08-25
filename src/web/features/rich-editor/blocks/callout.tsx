import { createReactBlockSpec } from '@blocknote/react'
import { ActionIcon, Menu, Tooltip } from '@mantine/core'
import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconBulb,
  IconInfoCircle,
  IconNote,
  IconTag
} from '@tabler/icons-react'
import { LAYOUT, UI_TEXT } from '../../../config/index.js'
import { debugLog, safeHash } from '../../../diagnostics/debug-log.js'
import classes from './callout.module.css'

/**
 * Callout variants. The stored value is the single source of truth; labels
 * and icons are presentation-only mappings so stored data never changes
 * when wording or icons evolve.
 */
export const CALLOUT_VARIANTS = ['info', 'note', 'tip', 'warning', 'danger'] as const

export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number]

interface CalloutVisual {
  icon: typeof IconInfoCircle
  className: string
  label: string
}

const CALLOUT_VISUALS: Record<CalloutVariant, CalloutVisual> = {
  info: { icon: IconInfoCircle, className: classes.info, label: UI_TEXT.calloutInfoLabel },
  note: { icon: IconNote, className: classes.note, label: UI_TEXT.calloutNoteLabel },
  tip: { icon: IconBulb, className: classes.tip, label: UI_TEXT.calloutTipLabel },
  warning: {
    icon: IconAlertTriangle,
    className: classes.warning,
    label: UI_TEXT.calloutWarningLabel
  },
  danger: { icon: IconAlertOctagon, className: classes.danger, label: UI_TEXT.calloutDangerLabel }
}

/**
 * Rich callout block (official custom-block API). The inline content is the
 * editable rich text; the variant is a stored prop so documents round-trip
 * deterministically through the canonical BlockNote JSON. The variant can be
 * changed after insertion from the callout's action menu without disturbing
 * the rich text or any other stored prop.
 */
export const createReactCalloutSpec = () =>
  createReactBlockSpec(
    {
      type: 'callout',
      propSchema: {
        variant: {
          default: 'info',
          values: [...CALLOUT_VARIANTS]
        }
      },
      content: 'inline'
    },
    {
      render: ({ block, editor, contentRef }) => {
        const variant = (CALLOUT_VARIANTS as readonly string[]).includes(
          block.props.variant as string
        )
          ? (block.props.variant as CalloutVariant)
          : 'info'
        const visual = CALLOUT_VISUALS[variant]
        const Icon = visual.icon

        const changeVariant = (next: CalloutVariant): void => {
          // Preserve every existing prop; only the variant changes.
          editor.updateBlock(block, { props: { ...block.props, variant: next } })
          debugLog('ui', 'ui_context_menu_action', {
            targetId: block.id,
            code: 'callout-variant',
            hash: safeHash(next)
          })
        }

        return (
          <div className={`${classes.callout} ${visual.className}`} data-variant={variant}>
            <Icon size={18} className={classes.icon} aria-hidden="true" />
            <div className={classes.content} ref={contentRef} data-testid="callout-content" />
            <Menu
              position="bottom-end"
              withinPortal
              zIndex={LAYOUT.overlayZIndex}
              shadow="sm"
              width={200}
            >
              <Menu.Target>
                <Tooltip label={UI_TEXT.calloutChangeTypeLabel} position="top-end">
                  <ActionIcon
                    className={classes.variantButton}
                    variant="subtle"
                    size="sm"
                    aria-label={UI_TEXT.calloutChangeTypeLabel}
                    data-testid="callout-variant-button"
                  >
                    <IconTag size={14} />
                  </ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                {CALLOUT_VARIANTS.map((value) => {
                  const itemVisual = CALLOUT_VISUALS[value]
                  const ItemIcon = itemVisual.icon
                  return (
                    <Menu.Item
                      key={value}
                      data-testid={`callout-variant-${value}`}
                      leftSection={<ItemIcon size={14} />}
                      onClick={() => changeVariant(value)}
                    >
                      {itemVisual.label}
                    </Menu.Item>
                  )
                })}
              </Menu.Dropdown>
            </Menu>
          </div>
        )
      }
    }
  )()
