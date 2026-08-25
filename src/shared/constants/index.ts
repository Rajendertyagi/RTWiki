export const APP_NAME = 'RTWiki' as const
export const APP_VERSION = '0.1.0' as const
export const API_PREFIX = '/api' as const
export const HEALTH_PATH = '/health' as const
export const DATABASE_FILENAME = 'rtwiki.sqlite' as const
export const ATTACHMENTS_DIR = 'attachments' as const
export const BACKUPS_DIR = 'backups' as const
export const LOGS_DIR = 'logs' as const
export const LOG_FILENAME = 'rtwiki.log' as const
export const DEFAULT_HOST = '127.0.0.1' as const
export const DEFAULT_PORT = 8080 as const
export const MAX_REQUEST_SIZE = 100 * 1024 * 1024
// Ceiling for page create/update JSON bodies: accommodates the worst-case
// JSON encoding overhead of a fully populated canonical HTML-page content
// document (2 MiB HTML + 2 x 512 KiB CSS/JS) with generous headroom.
export const MAX_PAGE_JSON_BODY_BYTES = 4 * 1024 * 1024
// Live-preview rebuild delay for editable HTML pages: applied after the last
// keystroke so typing never rebuilds the sandboxed document per keystroke.
export const PREVIEW_REBUILD_DEBOUNCE_MS = 800 as const
export const PROVISIONAL_AUTOSAVE_DEBOUNCE_MS = 2000 as const
export const PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024
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
