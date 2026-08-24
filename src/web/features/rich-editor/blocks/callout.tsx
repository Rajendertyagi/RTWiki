import { createReactBlockSpec } from '@blocknote/react'
import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconBulb,
  IconInfoCircle,
  IconNote
} from '@tabler/icons-react'
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
}

const CALLOUT_VISUALS: Record<CalloutVariant, CalloutVisual> = {
  info: { icon: IconInfoCircle, className: classes.info },
  note: { icon: IconNote, className: classes.note },
  tip: { icon: IconBulb, className: classes.tip },
  warning: { icon: IconAlertTriangle, className: classes.warning },
  danger: { icon: IconAlertOctagon, className: classes.danger }
}

/**
 * Rich callout block (official custom-block API). The inline content is the
 * editable rich text; the variant is a stored prop so documents round-trip
 * deterministically through the canonical BlockNote JSON.
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
      render: ({ block, contentRef }) => {
        const variant = (CALLOUT_VARIANTS as readonly string[]).includes(
          block.props.variant as string
        )
          ? (block.props.variant as CalloutVariant)
          : 'info'
        const visual = CALLOUT_VISUALS[variant]
        const Icon = visual.icon
        return (
          <div className={`${classes.callout} ${visual.className}`} data-variant={variant}>
            <Icon size={18} className={classes.icon} aria-hidden="true" />
            <div className={classes.content} ref={contentRef} />
          </div>
        )
      }
    }
  )()
