import { plainContentToString } from '@blocknote/core'
import { createReactBlockSpec } from '@blocknote/react'
import { MermaidBlockView } from './mermaid-block-view.js'

/**
 * Mermaid mind-map block. Distinct from the general Diagram block so the
 * insertion surfaces, labels and stored block type stay explicit, while
 * rendering shares the exact same secure Mermaid pipeline and security
 * restrictions.
 */
export const createReactMindMapSpec = () =>
  createReactBlockSpec(
    {
      type: 'mindMap',
      propSchema: {},
      content: 'plain'
    },
    {
      render: ({ block, editor, contentRef }) => (
        <MermaidBlockView
          blockId={block.id}
          source={plainContentToString(block.content)}
          blockType="mindMap"
          editor={editor as never}
          contentRef={contentRef}
        />
      )
    }
  )()
