import type { BlockNoteEditor } from '@blocknote/core'
import { ActionIcon, Button, Text, Textarea, Tooltip, useComputedColorScheme } from '@mantine/core'
import { IconPencil, IconPlayerPlay, IconRefresh } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { UI_TEXT } from '../../../config/index.js'
import { debugLog, safeHash } from '../../../diagnostics/debug-log.js'
import classes from './mermaid-block.module.css'
import { renderMermaidSvg } from './mermaid-render.js'

/**
 * Shared preview-first view for Mermaid-backed blocks (Diagram, Mind Map).
 *
 * Normal view: the rendered (sanitized) SVG only. Edit: a source textarea
 * with Apply/Cancel; Apply writes the plain-text content back through the
 * editor so autosave sees an ordinary document change. Render failures stay
 * contained to this block with a Retry action.
 */

export interface MermaidBlockViewProps {
  blockId: string
  /** The block's current plain-text Mermaid source. */
  source: string
  blockType: 'diagram' | 'mindMap'
  editor: BlockNoteEditor
}

const ERROR_MESSAGES = {
  parse_error: UI_TEXT.diagramErrorTitle,
  render_error: UI_TEXT.diagramErrorTitle
} as const

export function MermaidBlockView({
  blockId,
  source,
  blockType,
  editor
}: MermaidBlockViewProps): JSX.Element {
  const colorScheme = useComputedColorScheme('light')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(source)
  const [svg, setSvg] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<keyof typeof ERROR_MESSAGES | null>(null)
  const [renderSeq, setRenderSeq] = useState(0)
  const latestSourceRef = useRef(source)
  latestSourceRef.current = source

  // Re-render whenever the committed source, theme or retry sequence changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderSeq is the manual Retry trigger and is intentionally not read inside the effect
  useEffect(() => {
    let cancelled = false
    setErrorCode(null)
    void renderMermaidSvg(source, {
      theme: colorScheme === 'dark' ? 'dark' : 'default',
      blockId,
      blockType
    }).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setSvg(result.svg)
      } else {
        setSvg(null)
        setErrorCode(result.code)
      }
    })
    return () => {
      cancelled = true
    }
  }, [source, colorScheme, renderSeq, blockId, blockType])

  const startEditing = (): void => {
    setDraft(source)
    setEditing(true)
    debugLog('ui', 'ui_context_menu_action', { targetId: blockId, code: `${blockType}-edit` })
  }

  const apply = (): void => {
    setEditing(false)
    if (draft !== source) {
      editor.updateBlock({ id: blockId } as never, { content: draft } as never)
    }
    debugLog('ui', 'ui_context_menu_action', {
      targetId: blockId,
      code: `${blockType}-apply`,
      len: draft.length,
      hash: safeHash(draft)
    })
  }

  const cancel = (): void => {
    setDraft(source)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className={classes.editPane} data-testid={`${blockType}-edit`}>
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          minRows={6}
          autosize
          maxRows={18}
          aria-label={blockType === 'diagram' ? UI_TEXT.diagramLabel : UI_TEXT.mindMapLabel}
          data-testid={`${blockType}-source-input`}
        />
        <div className={classes.editActions}>
          <Button
            size="compact-xs"
            variant="filled"
            leftSection={<IconPlayerPlay size={12} />}
            onClick={apply}
            data-testid={`${blockType}-apply`}
          >
            {UI_TEXT.diagramApplyLabel}
          </Button>
          <Button size="compact-xs" variant="subtle" onClick={cancel}>
            {UI_TEXT.cancelButton}
          </Button>
        </div>
      </div>
    )
  }

  if (errorCode !== null) {
    return (
      <div className={classes.errorPane} data-testid={`${blockType}-error`}>
        <Text size="sm" c="red">
          {ERROR_MESSAGES[errorCode]}
        </Text>
        <div className={classes.editActions}>
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconRefresh size={12} />}
            onClick={() => setRenderSeq((seq) => seq + 1)}
            data-testid={`${blockType}-retry`}
          >
            {UI_TEXT.diagramRetryLabel}
          </Button>
          <Button size="compact-xs" variant="subtle" onClick={startEditing}>
            {UI_TEXT.diagramEditLabel}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={classes.previewPane}
      data-testid={`${blockType}-preview`}
      data-rendered={svg !== null}
    >
      <Tooltip label={UI_TEXT.diagramEditLabel} position="top">
        <ActionIcon
          className={classes.editButton}
          variant="subtle"
          size="sm"
          aria-label={UI_TEXT.diagramEditLabel}
          onClick={startEditing}
          data-testid={`${blockType}-edit-button`}
        >
          <IconPencil size={14} />
        </ActionIcon>
      </Tooltip>
      {svg !== null ? (
        <div
          className={classes.svgHost}
          data-testid={`${blockType}-svg`}
          // Sanitized by svg-sanitize.ts (script/handler/external-ref removal)
          // and Mermaid strict-mode DOMPurify before it reaches this state.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: contained sanitized SVG rendering
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <Text size="xs" c="dimmed" role="status">
          …
        </Text>
      )}
    </div>
  )
}
