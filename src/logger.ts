export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface Logger {
  error(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  debug(message: string, ...meta: unknown[]): void;
}

const LEVELS: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function isLogLevel(value: string | undefined): value is LogLevel {
  return value !== undefined && value in LEVELS;
}

/** Console logger with a minimum level. Defaults to LOG_LEVEL or 'info'. */
export class ConsoleLogger implements Logger {
  private readonly level: LogLevel;

  constructor(level?: LogLevel) {
    const fromEnv = process.env.LOG_LEVEL;
    this.level = level ?? (isLogLevel(fromEnv) ? fromEnv : 'info');
  }

  error(message: string, ...meta: unknown[]): void {
    this.write('error', message, meta);
  }

  warn(message: string, ...meta: unknown[]): void {
    this.write('warn', message, meta);
  }

  info(message: string, ...meta: unknown[]): void {
    this.write('info', message, meta);
  }

  debug(message: string, ...meta: unknown[]): void {
    this.write('debug', message, meta);
  }

  private write(level: LogLevel, message: string, meta: unknown[]): void {
    if (LEVELS[level] > LEVELS[this.level]) return;
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`;
    const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    out(line, ...meta);
  }
}

/** Logger that discards everything. Useful in tests. */
export const silentLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};
