export const APP_NAME = 'RTWiki' as const
export const APP_VERSION = '0.1.0' as const
export const HEALTH_PATH = '/health' as const
export const DATABASE_FILENAME = 'rtwiki.sqlite' as const
export const ATTACHMENTS_DIR = 'attachments' as const
export const BACKUPS_DIR = 'backups' as const
export const LOGS_DIR = 'logs' as const
export const LOG_FILENAME = 'rtwiki.log' as const
export const DEFAULT_HOST = '127.0.0.1' as const
export const DEFAULT_PORT = 8080 as const
// User-configurable ports must stay in the unprivileged range. Port 0 is
// reserved for test auto-assignment and is never accepted from settings.
export const MIN_USER_PORT = 1024 as const
export const MAX_USER_PORT = 65535 as const
// Ceiling for page create/update JSON bodies: accommodates the worst-case
// JSON encoding overhead of a fully populated canonical HTML-page content
// document (2 MiB HTML + 2 x 512 KiB CSS/JS) with generous headroom.
export const MAX_PAGE_JSON_BODY_BYTES = 4 * 1024 * 1024
// Ceiling for schedule entry, reminder and timetable-preset JSON bodies.
// A timetable is a list of small period/reminder records (titles capped at 200
// characters, times as HH:mm), so this is generous by roughly an order of
// magnitude even for a full-term preset of a few hundred periods — while still
// refusing an unbounded body before it is parsed. Provisional, like its
// neighbours. The former global `MAX_REQUEST_SIZE` (100 MB) was removed rather
// than enforced: no request path read it, and 100 MB is above every ceiling
// actually enforced, so it could not have changed any reachable outcome.
export const MAX_SCHEDULE_JSON_BODY_BYTES = 1024 * 1024
// Live-preview rebuild delay for editable HTML pages: applied after the last
// keystroke so typing never rebuilds the sandboxed document per keystroke.
export const PREVIEW_REBUILD_DEBOUNCE_MS = 800 as const
export const PROVISIONAL_AUTOSAVE_DEBOUNCE_MS = 2000 as const
export const PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024
// Ceiling on total pixels (width x height) of an uploaded image, enforced at
// ingest from the file's own header. This bounds what the browser must decode
// when the note is opened: 50 MP is about 8000x6000, which comfortably admits a
// modern phone photo while refusing the deliberately-constructed images that
// exist to exhaust a decoder. It is a limit on rendering cost, not on bytes -
// the byte ceiling above is that. Provisional, like the limits around it.
export const PROVISIONAL_MAX_IMAGE_PIXELS = 50_000_000
export const SHUTDOWN_TOKEN_HEADER = 'x-rtwiki-shutdown-token' as const

// Bounded log rotation: current file plus at most LOG_MAX_ROTATED_FILES rotated
// files (rtwiki.1.log .. rtwiki.3.log). Provisional centralized defaults.
export const LOG_MAX_BYTES = 1_000_000 as const
export const LOG_MAX_ROTATED_FILES = 3 as const

// Sanitized frontend-error reporting endpoint and its provisional limits.
export const CLIENT_ERRORS_PATH = '/api/client-errors' as const
export const MAX_CLIENT_ERROR_BODY_BYTES = 8 * 1024
export const CLIENT_ERROR_RATE_LIMIT_MAX = 20 as const
export const CLIENT_ERROR_RATE_LIMIT_WINDOW_MS = 60_000 as const

// Opt-in structured client debug logging (Debug Mode). Events are batched by
// the client and appended as JSONL to logs/rtwiki-debug.jsonl. All values are
// provisional centralized defaults and are defined exactly once here.
export const DEBUG_LOG_FILENAME = 'rtwiki-debug.jsonl' as const
export const DEBUG_LOG_MAX_BYTES = 1_000_000 as const
export const DEBUG_LOG_MAX_ROTATED_FILES = 3 as const
export const CLIENT_DEBUG_EVENTS_PATH = '/api/client-debug-events' as const
export const MAX_CLIENT_DEBUG_BODY_BYTES = 32 * 1024
export const CLIENT_DEBUG_RATE_LIMIT_MAX = 120 as const
export const CLIENT_DEBUG_RATE_LIMIT_WINDOW_MS = 60_000 as const
export const CLIENT_DEBUG_MAX_EVENTS_PER_BATCH = 100 as const
// Client-side batching: flush cadence and queue bound (oldest events dropped).
export const DEBUG_LOG_FLUSH_INTERVAL_MS = 2_000 as const
export const DEBUG_LOG_MAX_QUEUE = 500 as const
// After this many consecutive failed ingests the session stops sending until
// it is re-enabled, so a broken endpoint can never degrade editing.
export const DEBUG_LOG_MAX_CONSECUTIVE_FAILURES = 5 as const

// Marker stored as the plain-text content of a `codeBlock` when an unknown
// rich block is preserved during import/normalization. Single source of truth
// shared by the web document layer and the server search extractor so the
// preservation payload is never indexed or surfaced as readable text.
export const UNSUPPORTED_BLOCK_MARKER = '[unsupported block preserved below]' as const

// Starter Mermaid sources shared by the rich-editor insertion entries and the
// dedicated Diagram / Mind Map page starters. Defined exactly once.
export const DIAGRAM_STARTER_SOURCE = 'graph TD\n    A[Start] --> B[End]' as const
export const MINDMAP_STARTER_SOURCE =
  'mindmap\n  root((Main topic))\n    Topic A\n    Topic B' as const

// Study timetable / calendar (Slice 1). Single source of truth for the allowed
// event colors and default notification preferences. Colors are Mantine theme
// color keys so they map directly onto `ScheduleEventData.color`.
export const SCHEDULE_COLORS = [
  'blue',
  'grape',
  'violet',
  'indigo',
  'cyan',
  'teal',
  'green',
  'lime',
  'yellow',
  'orange',
  'red',
  'pink'
] as const

export type ScheduleColor = (typeof SCHEDULE_COLORS)[number]

export const DEFAULT_PERIOD_NOTIFICATIONS = {
  enabled: true,
  start: true,
  fiveMinBefore: true,
  customOffsets: [] as number[]
} as const

export const DEFAULT_REMINDER_NOTIFICATIONS = {
  enabled: true,
  customOffsets: [] as number[]
} as const

// Default visible time range for the week/day study views (HH:mm:ss).
export const SCHEDULE_DAY_START = '06:00:00' as const
export const SCHEDULE_DAY_END = '22:00:00' as const
// 1 = Monday, matching the school-week default.
export const SCHEDULE_FIRST_DAY_OF_WEEK = 1 as const
// Color used for one-off reminders in the calendar grid (distinct from periods).
export const SCHEDULE_REMINDER_COLOR = 'orange' as const

// Basenames that identify a compiled portable executable (browser-first
// artifact and desktop sidecar). Single source of truth for compiled-mode
// detection in server config (ADR-005, ADR-011); never repeat these literals.
export const COMPILED_EXE_BASENAMES = [
  'RTWiki.exe',
  'RTWiki',
  'RTWikiServer.exe',
  'RTWikiServer'
] as const

// Server-managed settings files inside data/ (portable, beside the database).
// The server owns reads/writes; the desktop shell reads them at boot.
export const SERVER_SETTINGS_FILENAME = 'server.json' as const
export const DESKTOP_SETTINGS_FILENAME = 'desktop.json' as const
// Flag file the frontend writes (via the server) to request a sidecar
// restart; the desktop shell consumes and deletes it. Never user-edited.
export const RESTART_REQUEST_FILENAME = 'restart-requested' as const
// Flag file the server writes when an authorized shutdown is accepted, so the
// shell can tell an intentional exit from a crash and leave the sidecar down
// (tray stays resident). Written only after the shutdown token check passes.
export const SHUTDOWN_REQUEST_FILENAME = 'shutdown-requested' as const

// Window close behaviors for the desktop shell (ADR-011). Single source of
// truth shared by the server validator, the Settings UI, and documentation.
export const CLOSE_BEHAVIORS = ['ask', 'minimize', 'quit'] as const

export type CloseBehavior = (typeof CLOSE_BEHAVIORS)[number]

// ---------------------------------------------------------------------------
// Backup and restore (docs/BACKUP_PLAN.md)
// ---------------------------------------------------------------------------

/**
 * The three fixed backup slots. Each owns exactly one file and overwrites only
 * itself, so storage is bounded at three files with no retention setting to get
 * wrong. The period name is the filename, not a timestamp, which is what makes
 * the bound hold.
 */
export const BACKUP_SLOTS = ['daily', 'weekly', 'monthly'] as const

export type BackupSlot = (typeof BACKUP_SLOTS)[number]

/**
 * Default age at which each slot becomes due, in hours.
 *
 * These are defaults, not policy: the intervals are user-configurable and stored
 * per slot. They exist so a fresh install has a sane schedule before anyone
 * opens Settings.
 */
export const BACKUP_DEFAULT_INTERVAL_HOURS: Readonly<Record<BackupSlot, number>> = {
  daily: 24,
  weekly: 24 * 7,
  monthly: 24 * 30
}

/** Ceiling and floor on a configured interval, in hours. */
export const MIN_BACKUP_INTERVAL_HOURS = 1
export const MAX_BACKUP_INTERVAL_HOURS = 24 * 365

/**
 * Suffix on an in-progress backup. `VACUUM INTO` requires the target not to
 * exist, so a backup is always written under this name and moved onto the slot
 * only once it has completed. Swept at startup, because "delete on failure"
 * does not run when the process is killed.
 */
export const BACKUP_PARTIAL_SUFFIX = '.partial' as const

/** `rtwiki-backup-daily` — the period name, per BACKUP_SLOTS. */
export const BACKUP_FILENAME_PREFIX = 'rtwiki-backup-' as const

/**
 * The live database, moved aside before a restore so a bad restore is
 * recoverable by hand. Lives in `data/`, not in the backup directory, so it is
 * never itself a backup candidate.
 */
export const PRE_RESTORE_FILENAME_PREFIX = 'rtwiki.pre-restore-' as const

/**
 * Backup settings live in their own file beside `server.json`, not in it.
 * `writeServerPort` replaces `server.json` wholesale with `{ port }`, so
 * sharing the file would mean every port change silently erased the schedule.
 */
export const BACKUP_SETTINGS_FILENAME = 'backups.json' as const

// Schedule cadence. A short periodic check plus a kickoff shortly after
// startup: a fixed slot means catching up overwrites rather than accumulates,
// so a long startup delay costs nothing and a missed run is picked up by the
// first check after it.
export const BACKUP_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
export const BACKUP_STARTUP_KICKOFF_MS = 5 * 60 * 1000

/**
 * Classified reasons a backup file is refused.
 *
 * Codes, not prose: the server returns one of these and the UI resolves it
 * through `UI_TEXT`, so a rejected restore always says which of the seven
 * validation steps failed rather than "invalid file".
 */
export const BACKUP_VALIDATION_REASONS = [
  'not-a-file',
  'not-a-database',
  'corrupt',
  'foreign-key-violation',
  'schema-too-new',
  'schema-missing-migration',
  'mid-migration-attachments'
] as const

export type BackupValidationReason = (typeof BACKUP_VALIDATION_REASONS)[number]
