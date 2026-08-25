import { plainContentToString } from '@blocknote/core'
import { createReactBlockSpec } from '@blocknote/react'
import { MermaidBlockView } from './mermaid-block-view.js'

/**
 * Mermaid diagram block. The diagram source is the block's plain-text
 * content, so stored documents stay canonical BlockNote JSON with no custom
 * attributes and no migration. Rendering goes through RTWiki's secure
 * Mermaid pipeline (fixed strict config, deterministic IDs, sanitized SVG).
 */
export const createReactDiagramSpec = () =>
  createReactBlockSpec(
    {
      type: 'diagram',
      propSchema: {},
      content: 'plain'
    },
    {
      render: ({ block, editor, contentRef }) => (
        <MermaidBlockView
          blockId={block.id}
          source={plainContentToString(block.content)}
          blockType="diagram"
          editor={editor as never}
          contentRef={contentRef}
        />
      )
    }
  )()
