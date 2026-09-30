import { plainContentToString } from '@blocknote/core'
import { createReactBlockSpec } from '@blocknote/react'
import { MermaidBlockView } from './mermaid-block-view.js'

/**
 * The two registered Mermaid block type names.
 *
 * `diagram` is the one RTWiki offers. `mindMap` is retained for READING only: it
 * was the Mind Map block, and documents written while it was offered still carry
 * it. Both names resolve to the same block — same plain-text source, same props,
 * same secure render pipeline — which is why there is one file and one view.
 *
 * The distinction that survives is behavioural, not structural: the view shows
 * zoom controls for `mindMap` and not for `diagram`
 * (blocks/mermaid-block-view.tsx). Keeping the alias keeps that behaviour
 * attached to the documents that already have it.
 */
export type MermaidBlockType = 'diagram' | 'mindMap'

/**
 * Container dimensions persist as pixel strings ('' = auto) so reload and
 * duplicate preserve sizes; existing documents without these props fall back to
 * the defaults — no migration, fully compatible.
 */
const SIZE_PROPS = { width: { default: '' }, height: { default: '' } } as const

/**
 * The view both specs render, so the two cannot drift apart.
 *
 * It is reached through a component rather than a shared factory because
 * `createReactBlockSpec` infers the block type from a literal in `config.type`,
 * and every downstream type — `block.props.width`, the plain-content union — is
 * then derived from that literal. A factory parameterised by the type leaves all
 * of them unresolved, so the two casts below are the price of writing the render
 * body once. Writing it twice is the alternative, and that is how the retired
 * blocks/mindmap.tsx came to disagree with blocks/diagram.tsx in the first place.
 */
function MermaidBlockSurface({
  blockId,
  content,
  props,
  blockType,
  editor,
  contentRef,
  onCommitSize
}: {
  blockId: string
  content: unknown
  props: { width: string; height: string }
  blockType: MermaidBlockType
  editor: unknown
  contentRef: (element: HTMLElement | null) => void
  onCommitSize: (width: string, height: string) => void
}) {
  return (
    <MermaidBlockView
      blockId={blockId}
      source={plainContentToString(content as never)}
      blockType={blockType}
      editor={editor as never}
      contentRef={contentRef}
      width={props.width}
      height={props.height}
      onCommitSize={onCommitSize}
    />
  )
}

/**
 * The Mermaid diagram block RTWiki offers. The diagram source is the block's
 * plain-text content, so stored documents stay canonical BlockNote JSON with no
 * custom attributes and no migration. Rendering goes through RTWiki's secure
 * Mermaid pipeline (fixed strict config, deterministic IDs, sanitized SVG).
 */
export const createReactDiagramSpec = () =>
  createReactBlockSpec(
    { type: 'diagram', propSchema: SIZE_PROPS, content: 'plain' },
    {
      render: ({ block, editor, contentRef }) => (
        <MermaidBlockSurface
          blockId={block.id}
          content={block.content}
          props={block.props as { width: string; height: string }}
          blockType="diagram"
          editor={editor}
          contentRef={contentRef}
          onCommitSize={(width, height) =>
            editor.updateBlock(block, { props: { ...block.props, width, height } })
          }
        />
      )
    }
  )()

/**
 * Read-compatibility alias for documents that already contain a Mind Map block.
 * Nothing offers this type any more: the toolbar inserts `diagram` with a chosen
 * template, and Mermaid's `mindmap` is one of those templates.
 */
export const createReactMindMapSpec = () =>
  createReactBlockSpec(
    { type: 'mindMap', propSchema: SIZE_PROPS, content: 'plain' },
    {
      render: ({ block, editor, contentRef }) => (
        <MermaidBlockSurface
          blockId={block.id}
          content={block.content}
          props={block.props as { width: string; height: string }}
          blockType="mindMap"
          editor={editor}
          contentRef={contentRef}
          onCommitSize={(width, height) =>
            editor.updateBlock(block, { props: { ...block.props, width, height } })
          }
        />
      )
    }
  )()
