import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value === '' ? undefined : value));

/** Configuração da API (variáveis de ambiente validadas na inicialização). */
export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3001),
  REALTIME_PORT: z.coerce.number().int().default(3002),
  /** `embedded`: gateway no mesmo processo da API; `separate`: só via main.realtime (ADR 0027). */
  REALTIME_MODE: z.enum(['embedded', 'separate']).default('embedded'),
  APP_URL: z.url().default('http://localhost:3000'),
  API_URL: z.url().default('http://localhost:3001'),
  BASE_DOMAIN: z.string().default('localhost'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  DATABASE_APP_URL: z.string().min(1),
  DATABASE_AUTH_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().default(20),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('cube-track'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(600),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  /**
   * Tolerância para reapresentar um refresh token recém-rotacionado cuja resposta se perdeu (aba
   * fechada, rede móvel): reemite a sessão em vez de revogar a família. 0 desativa.
   */
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(120).default(30),
  /** Chave AES-256-GCM em base64 (32 bytes) para segredos TOTP e similares. */
  ENCRYPTION_KEY: z
    .string()
    .refine(
      (value) => Buffer.from(value, 'base64').length === 32,
      'ENCRYPTION_KEY deve ter 32 bytes em base64',
    ),
  COOKIE_SECURE: bool.default(false),
  COOKIE_DOMAIN: optionalString,
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(600),
  MEILI_URL: z.string().default('http://localhost:7700'),
  MEILI_API_KEY: z.string().default(''),
  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_BUCKET: z.string().default('cubetrack-files'),
  S3_FORCE_PATH_STYLE: bool.default(true),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .default(100 * 1024 * 1024),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().default(900),
  OAUTH_GOOGLE_CLIENT_ID: optionalString,
  OAUTH_GOOGLE_CLIENT_SECRET: optionalString,
  OAUTH_GOOGLE_ISSUER: z.string().default('https://accounts.google.com'),
  OAUTH_GOOGLE_AUTHORIZATION_URL: z
    .string()
    .default('https://accounts.google.com/o/oauth2/v2/auth'),
  OAUTH_GOOGLE_TOKEN_URL: z.string().default('https://oauth2.googleapis.com/token'),
  OAUTH_GOOGLE_JWKS_URL: z.string().default('https://www.googleapis.com/oauth2/v3/certs'),
  OAUTH_MICROSOFT_CLIENT_ID: optionalString,
  OAUTH_MICROSOFT_CLIENT_SECRET: optionalString,
  /** `organizations`, `common` ou o id do diretório Entra ID. */
  OAUTH_MICROSOFT_TENANT: z.string().default('organizations'),
  OAUTH_MICROSOFT_AUTHORITY: z.string().default('https://login.microsoftonline.com'),
  OAUTH_MICROSOFT_JWKS_URL: optionalString,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  METRICS_PORT: z.coerce.number().int().default(9464),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalString,
  OTEL_SERVICE_NAME: z.string().default('cube-track-api'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuração inválida: ${details}`);
  }
  return parsed.data;
}
