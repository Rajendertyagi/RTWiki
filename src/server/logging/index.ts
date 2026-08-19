import { joinPaths } from '../config/index.js'

export type LogLevel = 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  module?: string
}

export class Logger {
  private readonly logPath: string
  private readonly stream: Bun.Output
  private readonly buffer: LogEntry[] = []
  private readonly bufferSize = 100

  constructor(logPath: string) {
    this.logPath = logPath
    this.stream = Bun.file(logPath)
  }

  info(message: string, module?: string): void {
    this.write({ timestamp: new Date().toISOString(), level: 'info', message, module })
  }

  warn(message: string, module?: string): void {
    this.write({ timestamp: new Date().toISOString(), level: 'warn', message, module })
  }

  error(message: string, module?: string): void {
    this.write({ timestamp: new Date().toISOString(), level: 'error', message, module })
    console.error(`[${this.formatTimestamp()}] [ERROR] ${message}`)
  }

  private write(entry: LogEntry): void {
    this.buffer.push(entry)
    if (this.buffer.length >= this.bufferSize) {
      this.flush()
    }
    const line = this.formatLine(entry)
    console.log(line)
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return
    const lines = this.buffer.map((e) => this.formatLine(e)).join('\n')
    this.buffer = []
    try {
      await this.stream.write(lines + '\n')
    } catch {
      // Log file may not be writable; silently skip to avoid crashing the app
    }
  }

  private formatLine(entry: LogEntry): string {
    return `[${entry.timestamp}] [${entry.level.toUpperCase()}]${entry.module ? ` [${entry.module}]` : ''} ${entry.message}`
  }

  private formatTimestamp(): string {
    return new Date().toISOString()
  }
}

export function createLogger(logPath: string): Logger {
  return new Logger(logPath)
}
