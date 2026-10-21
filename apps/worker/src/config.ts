import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');
const optional = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value === '' ? undefined : value));

export const WorkerConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_APP_URL: z.string().min(1),
  DATABASE_RELAY_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  APP_URL: z.url().default('http://localhost:3000'),
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  EMAIL_FROM: z.string().default('CUBE TRACK <nao-responda@cubetrack.com.br>'),
  /** Mesmo segredo da API — assina/confere o endereço de resposta por e-mail (ADR 0048). */
  JWT_SECRET: z.string().min(32),
  MAIL_REPLY_DOMAIN: z.string().default('reply.cubetrack.local'),
  MEILI_URL: z.string().default('http://localhost:7700'),
  MEILI_API_KEY: z.string().default(''),
  S3_ENDPOINT: optional,
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_BUCKET: z.string().default('cubetrack-files'),
  S3_FORCE_PATH_STYLE: bool.default(true),
  /** `clamd`: varredura via ClamAV (INSTREAM); `disabled`: só fora de produção (marca como limpo). */
  ANTIVIRUS_MODE: z.enum(['clamd', 'disabled']).default('clamd'),
  CLAMD_HOST: z.string().default('localhost'),
  CLAMD_PORT: z.coerce.number().int().default(3310),
  OUTBOX_POLL_MS: z.coerce.number().int().min(50).default(500),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(200),
  OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(8),
  BOARD_PORT: z.coerce.number().int().default(3010),
  BULL_BOARD_USER: optional,
  BULL_BOARD_PASSWORD: optional,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const rootEnv = resolve(import.meta.dirname, '../../../.env');
  if (env === process.env && existsSync(rootEnv)) loadDotenv({ path: rootEnv, quiet: true });
  const parsed = WorkerConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Configuração inválida do worker: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.ANTIVIRUS_MODE === 'disabled') {
    throw new Error('ANTIVIRUS_MODE=disabled não é permitido em produção.');
  }
  return parsed.data;
}

export function redisConnection(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.password === '' ? {} : { password: decodeURIComponent(parsed.password) }),
    maxRetriesPerRequest: null,
  };
}
