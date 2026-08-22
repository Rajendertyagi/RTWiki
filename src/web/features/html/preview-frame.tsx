import { Alert, Box, Button, Group, Stack, Text } from '@mantine/core'
import type { HtmlPageContent } from '@rtwiki/shared/schemas/html-content'
import { IconAlertCircle, IconShieldLock } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { reportClientError } from '../../diagnostics/error-reporter.js'
import classes from './html-preview.module.css'
import { normalizePreviewHtml } from './normalize-html.js'
import { buildPreviewDocument } from './preview-document.js'
import { isValidPreviewMessage, type PreviewMessage } from './preview-messages.js'

/**
 * Sandboxed HTML preview.
 *
 * Security model:
 * - `<iframe sandbox="allow-scripts" srcdoc="...">` — never allow-same-origin,
 *   allow-top-navigation, allow-popups or allow-forms.
 * - Opaque origin forces `targetOrigin="*"` on postMessage, so every inbound
 *   message must pass three independent checks before it is acted upon:
 *   source identity, strict schema, and the exact per-preview channel ID.
 *   Anything else is silently ignored — never logged, never surfaced.
 */

/** 16 cryptographically random bytes, hex-encoded (32 chars). */
export function generateChannelId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let id = ''
  for (const byte of bytes) {
    id += byte.toString(16).padStart(2, '0')
  }
  return id
}

export interface PreviewFrameProps {
  content: HtmlPageContent
  /** Per-response parent CSP nonce read from the served document's meta tag. */
  nonce?: string
}

type PreviewStatus =
  | { kind: 'idle' }
  | { kind: 'ready' }
  | { kind: 'runtime-issue'; operation: string; errorName?: string }

function readParentNonce(): string | undefined {
  const meta = document.querySelector('meta[name="rtwiki-preview-nonce"]')
  const value = meta?.getAttribute('content') ?? undefined
  return value && value.length > 0 ? value : undefined
}

interface BuildResult {
  srcdoc?: string
  error?: string
}

export function PreviewFrame({ content, nonce: nonceProp }: PreviewFrameProps): JSX.Element {
  // The nonce normally arrives via prop; reading the meta tag keeps the
  // component usable in isolation. Hooks stay unconditional.
  const nonceFromDocument = useMemo(readParentNonce, [])
  const nonce = nonceProp ?? nonceFromDocument

  const [status, setStatus] = useState<PreviewStatus>({ kind: 'idle' })
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const channelIdRef = useRef<string>('')

  // Builds (or rebuilds) the srcdoc document. Every call regenerates the
  // channel ID so stale messages from a previous preview can never be
  // accepted by the listener; failures are reported and rendered as a
  // recoverable error instead of crashing the workspace.
  const buildPreview = useCallback((): BuildResult => {
    try {
      if (!nonce) {
        return { error: UI_TEXT.htmlPreviewNonceMissing }
      }
      channelIdRef.current = generateChannelId()
      const normalized = normalizePreviewHtml(content.html)
      return {
        srcdoc: buildPreviewDocument({
          normalizedHead: normalized.head,
          normalizedBody: normalized.body,
          css: content.css,
          javascript: content.javascript,
          nonce,
          channelId: channelIdRef.current
        })
      }
    } catch (error) {
      reportClientError('html_preview_error', {
        pageType: 'html',
        component: 'PreviewFrame.build',
        error
      })
      return { error: UI_TEXT.htmlPreviewBuildFailed }
    }
  }, [content, nonce])

  const [result, setResult] = useState<BuildResult>(() => buildPreview())

  // Rebuild whenever the page content or the serving nonce changes.
  useEffect(() => {
    setResult(buildPreview())
  }, [buildPreview])

  const retry = useCallback((): void => {
    setStatus({ kind: 'idle' })
    setResult(buildPreview())
  }, [buildPreview])

  const handleMessage = useCallback((event: MessageEvent): void => {
    // Check 1: identity — only our own iframe's window may talk to us.
    if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
      return
    }
    // Check 2: strict schema (unknown fields rejected).
    if (!isValidPreviewMessage(event.data)) {
      return
    }
    // Check 3: exact current channel ID — wrong/stale channels are ignored.
    const message = event.data as PreviewMessage
    if (message.channel !== channelIdRef.current) {
      return
    }
    if (message.type === 'rtwiki-preview-ready') {
      setStatus({ kind: 'ready' })
      return
    }
    setStatus({
      kind: 'runtime-issue',
      operation: message.operation ?? 'unknown',
      errorName: message.errorName
    })
  }, [])

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [handleMessage])

  if (result.error) {
    return (
      <Stack gap="md" p="md">
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          title={UI_TEXT.htmlPreviewErrorTitle}
          variant="light"
        >
          <Text size="sm">{result.error}</Text>
          <Text size="xs" c="dimmed" mt="xs">
            {UI_TEXT.htmlPreviewPreservedNotice}
          </Text>
        </Alert>
        <Box>
          <Button variant="light" onClick={retry}>
            {UI_TEXT.retry}
          </Button>
        </Box>
      </Stack>
    )
  }

  return (
    <Stack
      gap="xs"
      className={classes.root}
      data-testid="html-preview"
      // Test observability: reflects which validated messages were accepted.
      data-preview-status={status.kind}
    >
      <Group gap="xs">
        <IconShieldLock size={14} />
        <Text size="xs" c="dimmed">
          {UI_TEXT.htmlPreviewSandboxNotice}
        </Text>
      </Group>
      {status.kind === 'runtime-issue' ? (
        <Alert color="yellow" variant="light" title={UI_TEXT.htmlPreviewRuntimeTitle}>
          <Text size="sm">{UI_TEXT.htmlPreviewRuntimeMessage}</Text>
        </Alert>
      ) : null}
      <iframe
        ref={iframeRef}
        title={UI_TEXT.htmlPreviewIframeTitle}
        sandbox="allow-scripts"
        srcDoc={result.srcdoc}
        className={classes.frame}
        data-testid="preview-iframe"
      />
    </Stack>
  )
}
