import { inject } from 'vitest';

/** Ambiente do worker nos testes (antes de cada arquivo importar os módulos). */
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_APP_URL: inject('appUrl'),
  DATABASE_RELAY_URL: inject('relayUrl'),
  REDIS_URL: inject('redisUrl'),
  MEILI_URL: inject('meiliUrl'),
  MEILI_API_KEY: inject('meiliKey'),
  S3_ENDPOINT: inject('s3Endpoint'),
  S3_BUCKET: 'cubetrack-test',
  S3_ACCESS_KEY: 'S3RVER',
  S3_SECRET_KEY: 'S3RVER',
  SMTP_URL: 'json://',
  ANTIVIRUS_MODE: 'disabled',
  LOG_LEVEL: 'silent',
  OTEL_SDK_DISABLED: 'true',
  APP_URL: 'http://app.test',
});
