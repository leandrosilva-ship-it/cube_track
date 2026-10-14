import pino from 'pino';

export const logger = pino({
  name: 'cube-track-worker',
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: ['*.password', '*.token', 'data.link'], censor: '[redacted]' },
});
export type Logger = typeof logger;
