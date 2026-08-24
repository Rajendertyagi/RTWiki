import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { LOG_MAX_BYTES, LOG_MAX_ROTATED_FILES } from '@rtwiki/shared/constants'

export interface RotatingSinkOptions {
  /** Maximum size of the current file before rotation. */
  maxBytes?: number
  /** Number of rotated files retained (<name>.1.ext .. <name>.N.ext). */
  maxRotatedFiles?: number
}

/**
 * Bounded rotating JSONL file sink shared by the application logger and the
 * opt-in client debug log.
 *
 * Design decisions (mirroring the original FileLogger behaviour):
 * - The directory and file are created eagerly in the constructor so the log
 *   exists from startup, not after the first append.
 * - Every line is appended synchronously; nothing is buffered in memory, so
 *   records survive abrupt process termination.
 * - Rotation is bounded: current file plus at most `maxRotatedFiles` rotated
 *   files. A failed rotation never blocks appending; it is retried at a later
 *   threshold check. Only an open/append failure disables the sink.
 * - Logging must never crash RTWiki: all filesystem failures degrade to a
 *   single safe terminal warning naming only the failed operation.
 */
export class RotatingJsonlSink {
  private readonly filePath: string
  private readonly maxBytes: number
  private readonly maxRotatedFiles: number
  private enabled = true
  private warningEmitted = false

  constructor(filePath: string, options: RotatingSinkOptions = {}) {
    this.filePath = filePath
    this.maxBytes = options.maxBytes ?? LOG_MAX_BYTES
    this.maxRotatedFiles = options.maxRotatedFiles ?? LOG_MAX_ROTATED_FILES
    this.initializeFile()
  }

  /**
   * Appends one pre-serialized line (including its newline). Returns false
   * when the sink is disabled; callers treat that as "file logging off".
   */
  appendLine(line: string): boolean {
    if (!this.enabled) return false
    try {
      this.rotateIfNeeded(Buffer.byteLength(line, 'utf8') + 1)
      appendFileSync(this.filePath, `${line}\n`)
      return true
    } catch {
      this.disable('append to log file')
      return false
    }
  }

  private initializeFile(): void {
    try {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      if (!existsSync(this.filePath)) {
        appendFileSync(this.filePath, '')
      }
    } catch {
      this.disable('open log file')
    }
  }

  /**
   * Shifts <name>.N.ext -> <name>.N+1.ext (deleting the oldest) and moves the
   * current file to <name>.1.ext when the size threshold would be exceeded.
   */
  private rotateIfNeeded(incomingBytes: number): void {
    let size = 0
    try {
      size = statSync(this.filePath).size
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
      renameSync(this.filePath, this.rotatedPath(1))
    } catch {
      if (!this.warningEmitted) {
        this.warningEmitted = true
        // eslint-disable-next-line no-console
        console.warn('RTWiki logging warning: could not rotate log file; continuing to append')
      }
    }
  }

  private rotatedPath(index: number): string {
    return this.filePath.replace(/\.log$|\.jsonl$/, `.${index}$&`)
  }

  private disable(operation: string): void {
    this.enabled = false
    if (!this.warningEmitted) {
      this.warningEmitted = true
      // eslint-disable-next-line no-console
      console.warn(
        `RTWiki logging warning: could not ${operation}; file logging is disabled for this session`
      )
    }
  }
}
