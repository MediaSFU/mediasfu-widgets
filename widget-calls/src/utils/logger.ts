/**
 * Logger utility with configurable log levels
 * Based on the react_ref logger implementation
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

// Set log level based on environment
const LOG_LEVEL = LogLevel.ERROR; // Default to ERROR

class Logger {
  private isDev = process.env.NODE_ENV === 'development';
  private logLevel = LOG_LEVEL;

  error(...args: any[]) {
    if (this.logLevel >= LogLevel.ERROR) {
      console.error('[ERROR]', ...args);
    }
  }

  warn(...args: any[]) {
    if (this.logLevel >= LogLevel.WARN) {
      console.warn('[WARN]', ...args);
    }
  }

  info(...args: any[]) {
    if (this.logLevel >= LogLevel.INFO) {
      console.info('[INFO]', ...args);
    }
  }

  debug(...args: any[]) {
    if (this.logLevel >= LogLevel.DEBUG && this.isDev) {
      console.log('[DEBUG]', ...args);
    }
  }

  log(...args: any[]) {
    // For general logs, only show in development
    if (this.isDev) {
      console.log(...args);
    }
  }

  // Context-specific loggers
  context(context: string) {
    return {
      error: (...args: any[]) => this.error(`[${context}]`, ...args),
      warn: (...args: any[]) => this.warn(`[${context}]`, ...args),
      info: (...args: any[]) => this.info(`[${context}]`, ...args),
      debug: (...args: any[]) => this.debug(`[${context}]`, ...args),
      log: (...args: any[]) => this.log(`[${context}]`, ...args),
    };
  }
}

export const logger = new Logger();

// Export context-specific loggers for components
export const callLogger = logger.context('CallManager');
export const roomLogger = logger.context('MediaSFU');
export const dialpadLogger = logger.context('Dialpad');
export const apiLogger = logger.context('API');
