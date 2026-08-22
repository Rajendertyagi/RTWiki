import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { LOG_MAX_BYTES, LOG_MAX_ROTATED_FILES } from '@rtwiki/shared/constants'

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
  private readonly logPath: string
  private readonly maxBytes: number
  private readonly maxRotatedFiles: number
  private sinkEnabled = true
  private sinkWarningEmitted = false
  private rotationWarningEmitted = false
  private closed = false

  constructor(logPath: string, options: LoggerOptions = {}) {
    this.logPath = logPath
    this.maxBytes = options.maxBytes ?? LOG_MAX_BYTES
    this.maxRotatedFiles = options.maxRotatedFiles ?? LOG_MAX_ROTATED_FILES
    this.initializeFile()
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

  private initializeFile(): void {
    try {
      const dir = dirname(this.logPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      if (!existsSync(this.logPath)) {
        appendFileSync(this.logPath, '')
      }
    } catch {
      this.disableSink('open log file')
    }
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
    if (!this.sinkEnabled) return
    try {
      this.rotateIfNeeded(Buffer.byteLength(line, 'utf8') + 1)
      appendFileSync(this.logPath, `${line}\n`)
    } catch {
      this.disableSink('append to log file')
    }
  }

  /**
   * Shifts rtwiki.N.log -> rtwiki.N+1.log (deleting the oldest) and moves the
   * current file to rtwiki.1.log when the size threshold would be exceeded.
   * A failure here is non-fatal: warn once and keep appending; the next
   * threshold check retries rotation.
   */
  private rotateIfNeeded(incomingBytes: number): void {
    let size = 0
    try {
      size = statSync(this.logPath).size
    } catch {
      return
    }
    if (size + incomingBytes <= this.maxBytes) return

    const oldest = this.rotatedPath(this.maxRotatedFiles)
    try {
      if (existsSync(oldest)) unlinkSync(oldest)
    } catch {
      // Keep going — the final rename may still succeed.
    }
    for (let index = this.maxRotatedFiles - 1; index >= 1; index--) {
      const from = this.rotatedPath(index)
      if (!existsSync(from)) continue
      try {
        renameSync(from, this.rotatedPath(index + 1))
      } catch {
        return
      }
    }
    try {
      renameSync(this.logPath, this.rotatedPath(1))
    } catch {
      if (!this.rotationWarningEmitted) {
        this.rotationWarningEmitted = true
        // eslint-disable-next-line no-console
        console.warn('RTWiki logging warning: could not rotate log file; continuing to append')
      }
    }
  }

  private rotatedPath(index: number): string {
    return this.logPath.replace(/\.log$/, `.${index}.log`)
  }

  private disableSink(operation: string): void {
    this.sinkEnabled = false
    if (!this.sinkWarningEmitted) {
      this.sinkWarningEmitted = true
      // eslint-disable-next-line no-console
      console.warn(
        `RTWiki logging warning: could not ${operation}; file logging is disabled for this session`
      )
    }
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
