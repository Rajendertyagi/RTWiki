import { ActionIcon, Badge, Box, Button, Group, Select, Stack, Text } from '@mantine/core'
import type { DebugEventCategory } from '@rtwiki/shared/schemas/debug-events'
import {
  IconArrowsSort,
  IconChevronDown,
  IconClearAll,
  IconPlayerPause,
  IconPlayerPlay
} from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import {
  clearDebugLogView,
  subscribeDebugLog,
  type DebugLogLevel,
  type DebugLogEntry,
  type DebugLogFields
} from '../../diagnostics/debug-log.js'
import classes from './debug-log-viewer.module.css'

const LEVELS: DebugLogLevel[] = ['debug', 'info', 'warn', 'error']
const LEVEL_LABEL: Record<DebugLogLevel, string> = {
  debug: UI_TEXT.debugLogsLevelDebug,
  info: UI_TEXT.debugLogsLevelInfo,
  warn: UI_TEXT.debugLogsLevelWarn,
  error: UI_TEXT.debugLogsLevelError
}

const CATEGORIES: DebugEventCategory[] = [
  'ui',
  'editor',
  'autosave',
  'preview',
  'navigation',
  'error'
]

interface DebugLogViewerProps {
  enabled: boolean
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString()
  } catch {
    return String(ts)
  }
}

function fieldSummary(fields: DebugLogFields): string {
  const parts: string[] = []
  for (const key of ['result', 'code', 'durMs', 'rev', 'gen', 'len'] as const) {
    const value = fields[key]
    if (value !== undefined) parts.push(`${key}=${String(value)}`)
  }
  return parts.join('  ')
}

/**
 * Live, read-only viewer for the existing Debug Mode stream.
 *
 * It subscribes to the single debugLog() buffer (no parallel logging) and shows
 * a scrollable, filterable stream. Pause freezes the visible buffer so reading
 * older entries is never interrupted by new ones; Clear empties only the
 * on-screen view. Auto-scroll follows new entries only when the reader is
 * already at the bottom. No note content is ever shown — every field is the
 * safe, allowlisted diagnostic shape.
 */
export function DebugLogViewer({ enabled }: DebugLogViewerProps): JSX.Element {
  const [entries, setEntries] = useState<DebugLogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [levels, setLevels] = useState<Set<DebugLogLevel>>(new Set(LEVELS))
  const [category, setCategory] = useState<DebugEventCategory | 'all'>('all')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const latestRef = useRef<DebugLogEntry[]>([])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)

  useEffect(() => {
    return subscribeDebugLog((next) => {
      latestRef.current = next
      if (!pausedRef.current) setEntries(next)
    })
  }, [])

  const visible = useMemo(
    () => entries.filter((e) => levels.has(e.level) && (category === 'all' || e.cat === category)),
    [entries, levels, category]
  )

  // Follow new entries only when the reader is already at the bottom.
  useEffect(() => {
    if (paused) return
    const el = scrollRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [paused])

  const handleScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  const toggleLevel = (level: DebugLogLevel): void => {
    setLevels((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  const handleResume = (): void => {
    setPaused(false)
    setEntries(latestRef.current)
  }

  const handleClear = (): void => {
    clearDebugLogView()
  }

  return (
    <Stack gap="xs" className={classes.root}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Group gap="xs" wrap="nowrap">
          {LEVELS.map((level) => (
            <Button
              key={level}
              size="xs"
              variant={levels.has(level) ? 'filled' : 'light'}
              color={level === 'error' ? 'red' : level === 'warn' ? 'yellow' : 'gray'}
              onClick={() => toggleLevel(level)}
              className={classes.levelChip}
            >
              {LEVEL_LABEL[level]}
            </Button>
          ))}
        </Group>
        <Group gap="xs" wrap="nowrap">
          {paused ? (
            <Button
              size="xs"
              variant="light"
              color="teal"
              leftSection={<IconPlayerPlay size={14} />}
              onClick={handleResume}
              data-testid="debug-log-resume"
            >
              {UI_TEXT.debugLogsResumeLabel}
            </Button>
          ) : (
            <ActionIcon
              variant="subtle"
              aria-label={UI_TEXT.debugLogsPauseLabel}
              onClick={() => setPaused(true)}
              data-testid="debug-log-pause"
            >
              <IconPlayerPause size={16} />
            </ActionIcon>
          )}
          <ActionIcon
            variant="subtle"
            aria-label={UI_TEXT.debugLogsClearLabel}
            onClick={handleClear}
            data-testid="debug-log-clear"
          >
            <IconClearAll size={16} />
          </ActionIcon>
        </Group>
      </Group>

      <Select
        size="xs"
        value={category}
        onChange={(value) => setCategory((value as DebugEventCategory | 'all') ?? 'all')}
        data={[
          { value: 'all', label: UI_TEXT.debugLogsAllLabel },
          ...CATEGORIES.map((c) => ({ value: c, label: c }))
        ]}
        leftSection={<IconArrowsSort size={14} />}
        aria-label={UI_TEXT.debugLogsCategoryLabel}
        className={classes.categorySelect}
      />

      <div className={classes.logRegion} ref={scrollRef} onScroll={handleScroll}>
        {!enabled ? (
          <Text size="sm" c="dimmed" className={classes.emptyState}>
            {UI_TEXT.debugLogsDisabledLabel}
          </Text>
        ) : visible.length === 0 ? (
          <Text size="sm" c="dimmed" className={classes.emptyState}>
            {UI_TEXT.debugLogsEmptyLabel}
          </Text>
        ) : (
          visible.map((entry) => (
            <div key={entry.id} className={classes.row}>
              <button
                type="button"
                className={classes.rowHeader}
                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                aria-expanded={expandedId === entry.id}
              >
                <IconChevronDown
                  size={12}
                  className={`${classes.rowChevron} ${expandedId === entry.id ? classes.rowChevronOpen : ''}`}
                />
                <span className={classes.time}>{formatTime(entry.ts)}</span>
                <Badge size="xs" className={`${classes.level} ${classes[`level-${entry.level}`]}`}>
                  {LEVEL_LABEL[entry.level]}
                </Badge>
                <span className={classes.category}>{entry.cat}</span>
                <span className={classes.event}>{entry.evt}</span>
                {fieldSummary(entry.fields) ? (
                  <span className={classes.summary}>{fieldSummary(entry.fields)}</span>
                ) : null}
              </button>
              {expandedId === entry.id ? (
                <Box className={classes.meta}>
                  {Object.entries(entry.fields).map(([key, value]) => (
                    <div key={key} className={classes.metaRow}>
                      <span className={classes.metaKey}>{key}</span>
                      <span className={classes.metaValue}>{String(value)}</span>
                    </div>
                  ))}
                </Box>
              ) : null}
            </div>
          ))
        )}
      </div>
    </Stack>
  )
}
