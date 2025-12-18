import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupLogger } from '@utils/logger';

describe('Logger Configuration', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let capturedLogs: string[] = [];
  let originalEnv: string | undefined;

  beforeEach(() => {
    capturedLogs = [];
    originalEnv = process.env.LOG_LEVEL;
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      capturedLogs.push(chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.LOG_LEVEL = originalEnv;
    } else {
      delete process.env.LOG_LEVEL;
    }
    stdoutWriteSpy.mockRestore();
  });

  it('should create a logger with default name and level', () => {
    const logger = setupLogger();

    expect(logger).toBeDefined();
    expect(logger.level).toBe('info');
  });

  it('should create a logger with custom name', () => {
    const logger = setupLogger('custom-module');
    logger.info('test message');

    expect(capturedLogs).toHaveLength(1);
    const logEntry = JSON.parse(capturedLogs[0].trim());
    expect(logEntry.name).toBe('custom-module');
  });

  it('should respect explicit log level parameter', () => {
    const logger = setupLogger('test', 'debug');

    expect(logger.level).toBe('debug');
  });

  it('should read log level from LOG_LEVEL environment variable', () => {
    process.env.LOG_LEVEL = 'DEBUG';
    const logger = setupLogger('env-test');

    expect(logger.level).toBe('debug');
  });

  it('should handle lowercase LOG_LEVEL environment variable', () => {
    process.env.LOG_LEVEL = 'warn';
    const logger = setupLogger('env-test');

    expect(logger.level).toBe('warn');
  });

  it('should default to info level when LOG_LEVEL is not set', () => {
    delete process.env.LOG_LEVEL;
    const logger = setupLogger('default-test');

    expect(logger.level).toBe('info');
  });

  it('should output uppercase level names in log output', () => {
    const logger = setupLogger('level-test', 'info');
    logger.info('test message');

    expect(capturedLogs).toHaveLength(1);
    const logEntry = JSON.parse(capturedLogs[0].trim());
    expect(logEntry.level).toBe('INFO');
  });

  it('should log at the configured level and suppress lower levels', () => {
    delete process.env.LOG_LEVEL;
    const logger = setupLogger('filter-test');

    // Debug should NOT be logged with default INFO level
    logger.debug('debug message');
    expect(capturedLogs).toHaveLength(0);

    // Info SHOULD be logged
    logger.info('info message');
    expect(capturedLogs).toHaveLength(1);
  });
});
