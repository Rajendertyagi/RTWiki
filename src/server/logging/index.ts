import { resolveRuntimePaths } from '../config/index.js'

export type LogLevel = 'info' | 'warn' | 'error'

export type LogContext = Record<string, unknown>

interface LogLine {
  timestamp: string
  level: LogLevel
  message: string
  [key: string]: unknown
}

/**
 * Structured logger that writes one JSON object per line (JSONL).
 *
 * Lines never contain absolute filesystem paths or secrets; callers pass a
 * small structured `context` (an `event` name plus non-sensitive fields).
 */
export class Logger {
  private readonly logPath: string
  private readonly stream: ReturnType<typeof Bun.file>
  private buffer: string[] = []
  private readonly bufferSize = 100
  private closed = false

  constructor(logPath: string) {
    this.logPath = logPath
    this.stream = Bun.file(logPath)
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context)
  }

  error(message: string, context?: LogContext): void {
    this.write('error', message, context)
    // Mirror errors to stderr for interactive debugging without polluting the log file's JSONL stream.
    // eslint-disable-next-line no-console
    console.error(
      this.toLine({
        timestamp: new Date().toISOString(),
        level: 'error',
        message,
        ...(context ?? {})
      })
    )
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (this.closed) return
    const line = this.toLine({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context ?? {})
    })
    this.buffer.push(line)
    if (this.buffer.length >= this.bufferSize) {
      void this.flush()
    }
    // eslint-disable-next-line no-console
    console.log(line)
  }

  private toLine(entry: LogLine): string {
    return JSON.stringify(entry)
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return
    const lines = `${this.buffer.join('\n')}\n`
    this.buffer = []
    try {
      await this.stream.write(lines)
    } catch {
      // Log destination may be unwritable (e.g. read-only media); never crash the app over logging.
    }
  }

  async close(): Promise<void> {
    await this.flush()
    this.closed = true
  }
}

export function createLogger(logPath: string): Logger {
  return new Logger(logPath)
}

// Application-wide logger. Path is derived from the portable layout via the shared config module.
export const logger = createLogger(resolveRuntimePaths().logPath)
