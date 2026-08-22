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
