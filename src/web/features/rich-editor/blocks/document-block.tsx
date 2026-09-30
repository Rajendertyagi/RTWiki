import { createReactBlockSpec } from '@blocknote/react'
import { Button, Group, Loader, Modal, Stack, Text, Textarea } from '@mantine/core'
import { IconDownload, IconEye, IconFileText } from '@tabler/icons-react'
import { useCallback, useState } from 'react'
import {
  ACCEPTED_DOCUMENT_EXTENSIONS,
  ACCEPTED_DOCUMENT_MIME_TYPES
} from '../../../../shared/attachments/document-formats.js'
import { LAYOUT, UI_TEXT } from '../../../config/index.js'
import classes from './document-block.module.css'

/**
 * Rich "document" block: a card with three ways to open the attached file.
 *
 * ## Why a custom block rather than BlockNote's built-in `file`
 *
 * The built-in `file` block renders the file's name inside a `div`, not an
 * anchor, so an attached document is **not clickable at all** — there is no route
 * from a note to the file. That was true before this block existed and it is the
 * reason this block does.
 *
 * The other reason is that there are three actions, and the built-in block has no
 * place to put them. Reusing it would have meant reaching into its internals.
 *
 * ## The three actions, and why this order
 *
 * - **View text** reads the text RTWiki already extracted. It opens no file, so it
 *   has none of the exposure described in ADR-016, and it is the only option that
 *   works for a format no browser can draw. It is first for that reason.
 * - **View** opens a new tab and lets the browser draw the file. This is the
 *   same-origin exposure ADR-016 records; it is opt-in per click, never automatic.
 * - **Download** is unchanged behaviour and keeps working exactly as it did.
 *
 * ## The stored prop is the URL, and nothing else
 *
 * `url` is the same `/api/attachments/<uuid>` the image block stores, so a
 * document and an image are addressed identically and a filename never reaches the
 * server. The filename shown here is the *stored* one, fetched alongside the text
 * rather than duplicated into the document — so it stays correct if an upload is
 * ever renamed, and a document's content does not grow a copy of its own name.
 */
export const createReactDocumentSpec = () =>
  createReactBlockSpec(
    {
      type: 'documentBlock',
      propSchema: {
        url: { default: '' },
        // The name as picked, kept for display before the catalogue is consulted.
        // Once resolved, the stored name from the server wins.
        name: { default: '' }
      },
      // 'plain' mirrors the diagram and linked-page blocks: the block keeps an
      // (empty, hidden) text host so BlockNote can attach content, while the
      // visible UI is the card.
      content: 'plain'
    },
    {
      /*
       * Decides whether a dropped or pasted file becomes this block.
       *
       * BlockNote scans every block's `fileBlockAccept` list and keeps the *last*
       * match, and the built-in `file` block accepts every media type - so without
       * this, a dropped PDF became a `file` block and arrived unopenable. The
       * list is imported from the shared allowlist rather than written here, so the
       * picker, the server and this block cannot disagree about what a document is.
       *
       * Dropping an image still yields an `image` block: `image/*` is not in this
       * list, so the `image` block's own entry remains the last match for one. That
       * is a consequence of the scan's ordering rather than a coincidence, and
       * `tests/browser/documents.pwspec.ts` asserts both directions.
       */
      meta: {
        fileBlockAccept: [...ACCEPTED_DOCUMENT_MIME_TYPES, ...ACCEPTED_DOCUMENT_EXTENSIONS]
      },
      render: ({ block, contentRef }) => {
        const url = (block.props.url as string) ?? ''
        // The name shown on the card is the block's own `props.name`, written at insert
        // time from the file the user picked. That is authoritative.
        //
        // This used to be refined by fetching `/api/attachments/:id/text` on mount and
        // reading an `originalName` from the response. **That field does not exist** —
        // the route has always returned `{ text, kind }` — so `readString` returned
        // null, `setStoredName` was never called, and the state could only ever equal
        // `props.name`. It was a network request per document block on every note open
        // that could not change what was displayed, with a `.catch` that hid the fact.
        //
        // The `/text` route keeps its narrow contract: extracted text and kind, for
        // "View text". Serving a filename from it as well would mean every note carrying
        // a document costs a request to learn a name the note already holds.
        const storedName = (block.props.name as string) ?? ''
        const [text, setText] = useState<string | null>(null)
        const [textState, setTextState] = useState<
          'idle' | 'loading' | 'ready' | 'empty' | 'error'
        >('idle')
        const [textOpen, setTextOpen] = useState(false)

        const attachmentId = attachmentIdFrom(url)

        // The text is fetched when the user asks for it, not on mount: a note can
        // hold many attachments and none of them should cost a request until
        // someone wants to read one.
        const openText = useCallback(() => {
          setTextOpen(true)
          if (textState !== 'idle' || !attachmentId) return
          setTextState('loading')
          void fetch(`/api/attachments/${attachmentId}/text`)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error('text unavailable'))))
            .then((body: unknown) => {
              const value = readString(body, 'text') ?? ''
              // A document with no extractable text — a scanned PDF, or a file the
              // parser could read but found empty — must say so. An empty box
              // would read as a bug rather than as an answer.
              setText(value.trim().length > 0 ? value : '')
              setTextState(value.trim().length > 0 ? 'ready' : 'empty')
            })
            .catch(() => {
              setTextState('error')
            })
        }, [attachmentId, textState])

        if (!url) {
          return (
            <div className={classes.card} data-testid="document-card">
              <div ref={contentRef} className={classes.hiddenHost} aria-hidden="true" />
              <Text size="sm" c="dimmed">
                {UI_TEXT.documentMissingLabel}
              </Text>
            </div>
          )
        }

        return (
          <div className={classes.card} data-testid="document-card">
            <div ref={contentRef} className={classes.hiddenHost} aria-hidden="true" />
            <div className={classes.icon} aria-hidden="true">
              <IconFileText size={16} />
            </div>
            <div className={classes.body}>
              <div className={classes.name} title={storedName}>
                {storedName || UI_TEXT.documentUnnamedLabel}
              </div>
            </div>
            <Group gap={4} className={classes.actions} role="group" aria-label={storedName}>
              {/*
                Buttons, not ActionIcons: each action needs an accessible name a
                screen reader announces, and an icon-only control cannot carry one
                visibly. `Button` gives a real focusable element with text.
              */}
              <Button
                size="compact-xs"
                variant="light"
                leftSection={<IconEye size={14} />}
                onClick={openText}
                data-testid="document-view-text"
              >
                {UI_TEXT.documentViewTextLabel}
              </Button>
              <Button
                size="compact-xs"
                variant="light"
                component="a"
                href={`${url}/view`}
                target="_blank"
                // `noopener` because `_blank` hands the opened document a
                // `window.opener` reference to RTWiki's tab by default. A PDF is
                // same-origin here (ADR-016), so without this the document could
                // navigate the notes tab out from under the user. `noreferrer`
                // additionally withholds the referrer, which is RTWiki's own
                // URL and carries a page id.
                rel="noopener noreferrer"
                leftSection={<IconEye size={14} />}
                data-testid="document-view"
              >
                {UI_TEXT.documentViewLabel}
              </Button>
              <Button
                size="compact-xs"
                variant="light"
                component="a"
                href={url}
                download
                leftSection={<IconDownload size={14} />}
                data-testid="document-download"
              >
                {UI_TEXT.documentDownloadLabel}
              </Button>
            </Group>
            <Modal
              opened={textOpen}
              onClose={() => setTextOpen(false)}
              title={storedName || UI_TEXT.documentUnnamedLabel}
              size="lg"
              centered
              overlayProps={{ backgroundOpacity: 0, blur: 0 }}
              zIndex={LAYOUT.overlayZIndex}
            >
              <Stack gap="sm" data-testid="document-text-panel">
                {textState === 'loading' ? (
                  <Group gap="xs">
                    <Loader size="sm" />
                    <Text size="sm" c="dimmed">
                      {UI_TEXT.documentTextLoading}
                    </Text>
                  </Group>
                ) : null}
                {textState === 'empty' ? (
                  <Text size="sm" c="dimmed" data-testid="document-text-empty">
                    {UI_TEXT.documentNoText}
                  </Text>
                ) : null}
                {textState === 'error' ? (
                  <Text size="sm" c="red" data-testid="document-text-error">
                    {UI_TEXT.documentTextUnavailable}
                  </Text>
                ) : null}
                {/*
                  `readOnly` rather than disabled: a disabled textarea is skipped
                  by keyboard navigation, so the text a screen-reader user came
                  here to read would be unreachable.
                */}
                {textState === 'ready' && text ? (
                  <Textarea
                    value={text}
                    readOnly
                    autosize
                    minRows={6}
                    maxRows={20}
                    aria-label={UI_TEXT.documentTextPanelLabel}
                    data-testid="document-text-body"
                    className={classes.textBody}
                  />
                ) : null}
              </Stack>
            </Modal>
          </div>
        )
      }
    }
  )()

/**
 * The catalogue id inside an attachment URL, or `null`.
 *
 * The URL is what gets stored, so this is how a block reaches its row. It accepts
 * only a UUID, which means a stored prop can never become a path to somewhere
 * else — the same reason the server refuses to be addressed by filename.
 */
function attachmentIdFrom(url: string): string | null {
  const match =
    /^\/api\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
      url
    )
  return match?.[1] ?? null
}

/** Reads one string field from a response body, or `null` if it is not there. */
function readString(body: unknown, field: string): string | null {
  if (typeof body !== 'object' || body === null) return null
  const value = (body as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : null
}
