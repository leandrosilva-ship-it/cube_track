import { randomBytes } from 'node:crypto';

import { inject } from 'vitest';

/** Variáveis de ambiente da API para os testes (definidas antes de cada arquivo criar a aplicação). */
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_APP_URL: inject('appUrl'),
  DATABASE_AUTH_URL: inject('authUrl'),
  DATABASE_POOL_MAX: '10',
  REDIS_URL: inject('redisUrl'),
  JWT_SECRET: 'test-secret-0123456789-0123456789-abcdef',
  ENCRYPTION_KEY: process.env.TEST_ENCRYPTION_KEY ?? randomBytes(32).toString('base64'),
  MEILI_URL: inject('meiliUrl'),
  MEILI_API_KEY: inject('meiliKey'),
  S3_ENDPOINT: inject('s3Endpoint'),
  S3_BUCKET: 'cubetrack-test',
  S3_ACCESS_KEY: 'S3RVER',
  S3_SECRET_KEY: 'S3RVER',
  S3_FORCE_PATH_STYLE: 'true',
  UPLOAD_MAX_BYTES: String(5 * 1024 * 1024),
  REALTIME_MODE: 'embedded',
  LOG_LEVEL: 'silent',
  OTEL_SDK_DISABLED: 'true',
  RATE_LIMIT_PER_MINUTE: '10000',
  APP_URL: 'http://app.test',
  BASE_DOMAIN: 'cubetrack.test',
  MAIL_REPLY_DOMAIN: 'reply.cubetrack.test',
  INBOUND_EMAIL_WEBHOOK_SECRET: 'test-inbound-email-webhook-secret',
});
process.env.TEST_ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
