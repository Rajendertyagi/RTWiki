import { LOG_MAX_BYTES, LOG_MAX_ROTATED_FILES } from '@rtwiki/shared/constants'
import { RotatingJsonlSink } from './rotating-sink.js'

export type LogLevel = 'info' | 'warn' | 'error'

export type LogContext = Record<string, unknown>

/**
 * The logger contract used across the server. `Logger` (file-backed) and
 * `ConsoleLogger` both satisfy it, so dependencies can be injected explicitly
 * instead of importing a module-level singleton.
 */
export interface Logger {
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void
  flush(): Promise<void>
  close(): Promise<void>
}

export interface LoggerOptions {
  /** Maximum size of the current log file before rotation. */
  maxBytes?: number
  /** Number of rotated files retained (rtwiki.1.log .. rtwiki.N.log). */
  maxRotatedFiles?: number
}

/**
 * Structured logger that appends one JSON object per line (JSONL) to
 * `<logPath>` and mirrors every line to the terminal.
 *
 * Design decisions:
 * - The directory and file are created eagerly in the constructor so
 *   `logs/rtwiki.log` exists from startup, not after the first flush.
 * - Every event is appended synchronously with the officially supported
 *   Node-compatible append API. Nothing is buffered in memory, so records
 *   survive abrupt process termination and earlier records are never
 *   truncated (the previous implementation overwrote the file on flush).
 * - Rotation is bounded: current file plus at most `maxRotatedFiles` rotated
 *   files. A failed rotation never blocks appending; it is retried at a later
 *   threshold check. Only an open/append failure disables the file sink.
 * - Logging must never crash RTWiki: all filesystem failures degrade to a
 *   single safe terminal warning naming only the failed operation.
 */
export class FileLogger implements Logger {
  private readonly sink: RotatingJsonlSink
  private closed = false

  constructor(logPath: string, options: LoggerOptions = {}) {
    this.sink = new RotatingJsonlSink(logPath, {
      maxBytes: options.maxBytes ?? LOG_MAX_BYTES,
      maxRotatedFiles: options.maxRotatedFiles ?? LOG_MAX_ROTATED_FILES
    })
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context)
  }

  error(message: string, context?: LogContext): void {
    this.write('error', message, context)
  }

  /**
   * Retained for API compatibility with the shutdown coordinator. Writes are
   * synchronous, so there is nothing buffered to flush.
   */
  async flush(): Promise<void> {}

  /** Idempotent. After close, further events are dropped silently. */
  async close(): Promise<void> {
    this.closed = true
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (this.closed) return
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context ?? {})
    })
    // eslint-disable-next-line no-console
    console.log(line)
    // File failures degrade to a terminal warning inside the shared sink.
    this.sink.appendLine(line)
  }
}

/**
 * Terminal-only logger for contexts that must not touch the filesystem
 * (module-import time defaults, tests, degraded environments).
 */
export class ConsoleLogger implements Logger {
  info(message: string, context?: LogContext): void {
    this.print('info', message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.print('warn', message, context)
  }

  error(message: string, context?: LogContext): void {
    this.print('error', message, context)
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {}

  private print(level: LogLevel, message: string, context?: LogContext): void {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context ?? {})
    })
    // eslint-disable-next-line no-console
    console.log(line)
  }
}

export function createLogger(logPath: string, options?: LoggerOptions): Logger {
  return new FileLogger(logPath, options)
}

export function createConsoleLogger(): Logger {
  return new ConsoleLogger()
}
