/**
 * Structured JSON logger for AWS Lambda.
 *
 * Uses Pino for production-grade JSON logging with CloudWatch compatibility.
 */

import pino from 'pino';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Create and configure a Pino logger instance.
 *
 * Reads LOG_LEVEL from environment variable (supports both lowercase and uppercase).
 * Defaults to 'info' if not specified.
 *
 * @param name - Logger name
 * @param level - Optional log level override
 * @returns Configured Pino logger
 */
export function setupLogger(name: string = 'lights-out', level?: string): pino.Logger {
  const logLevel: LogLevel = (level?.toLowerCase() ||
    process.env.LOG_LEVEL?.toLowerCase() ||
    'info') as LogLevel;

  return pino({
    name,
    level: logLevel,
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
