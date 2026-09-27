import { Button, Text } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import type { CSSVars } from '../../style-props.js'
import { renderMermaidSvg } from '../rich-editor/blocks/mermaid-render.js'
import classes from './mermaid-workspace.module.css'

/** Why a diagram failed to draw. Owned here because this is where it is produced. */
export type RenderErrorCode = 'parse_error' | 'render_error'

/**
 * One rendered diagram.
 *
 * Extracted so a page holding several diagrams can own one of these per block.
 * Each instance keeps its own render state, so a failure or a slow render is
 * confined to the block that caused it: before this, a page could only hold one
 * diagram and the render state lived in the workspace, which is not reusable once
 * the list exists.
 *
 * The render is sanitised exactly as it always was, in the same pipeline
 * (`svg-sanitize.ts` plus Mermaid strict-mode DOMPurify). Nothing about the
 * sanitisation changed; it was moved, not rewritten.
 */
export interface DiagramCanvasProps {
  /** Mermaid source for this block. */
  source: string
  /**
   * Unique per block on the page. Becomes the pipeline's render id, so two blocks
   * cannot collide on one document.
   */
  renderKey: string
  mermaidBlockType: 'diagram' | 'mindMap'
  colorScheme: string
  fit: boolean
  zoom: number
  /**
   * Page-level refresh counter. Changing it re-renders this block, so one press
   * of Refresh on the page re-renders every diagram on it.
   */
  renderSeq: number
  /** Test id stem, e.g. `diagram` or `mindmap`. */
  testId: string
}

export function DiagramCanvas({
  source,
  renderKey,
  mermaidBlockType,
  colorScheme,
  fit,
  zoom,
  renderSeq,
  testId
}: DiagramCanvasProps): JSX.Element {
  const [svg, setSvg] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<RenderErrorCode | null>(null)
  // The block's own retry counter, separate from the page-level `renderSeq`. The
  // page's Refresh reaches every block; this one re-renders only the block whose
  // Retry was pressed, which is the point of having it on that block.
  const [localSeq, setLocalSeq] = useState(0)
  const genRef = useRef(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: renderSeq and localSeq are the page Refresh and this block's Retry triggers; they are deliberately not read inside the effect, and removing them would make both buttons do nothing
  useEffect(() => {
    const gen = ++genRef.current
    const ac = new AbortController()
    setErrorCode(null)
    void renderMermaidSvg(source, {
      theme: colorScheme === 'dark' ? 'dark' : 'default',
      blockId: renderKey,
      blockType: mermaidBlockType,
      signal: ac.signal
    }).then((result) => {
      if (gen !== genRef.current) return
      if (result.ok) {
        setSvg(result.svg)
      } else {
        // Superseded or unmounted: not a failure, so keep what is on screen.
        if (result.code === 'cancelled') return
        setSvg(null)
        setErrorCode(result.code)
      }
    })
    return () => ac.abort()
  }, [source, colorScheme, renderSeq, localSeq, renderKey, mermaidBlockType])

  if (errorCode !== null) {
    return (
      <div className={classes.errorBox} data-testid={`${testId}-error`} role="alert">
        <Text size="sm" c="red">
          {UI_TEXT.diagramErrorTitle}
        </Text>
        <Button
          size="compact-xs"
          variant="light"
          mt="xs"
          leftSection={<IconRefresh size={12} />}
          onClick={() => setLocalSeq((seq) => seq + 1)}
          data-testid={`${testId}-retry`}
        >
          {UI_TEXT.diagramRetryLabel}
        </Button>
      </div>
    )
  }

  if (svg === null) {
    return (
      <Text size="xs" c="dimmed" role="status" data-testid={`${testId}-rendering`}>
        …
      </Text>
    )
  }

  return (
    <div className={`${classes.svgHost} ${fit ? classes.fit : classes.actual}`}>
      <div className={classes.zoomHost} style={{ '--zoom-level': `${zoom * 100}%` } as CSSVars}>
        {/* Sanitized by svg-sanitize.ts + Mermaid strict-mode DOMPurify. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: contained sanitized SVG rendering */}
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </div>
  )
}
