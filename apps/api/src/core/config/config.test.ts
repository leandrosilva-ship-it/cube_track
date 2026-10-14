import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from 'dotenv';
import { describe, expect, it } from 'vitest';

import { ConfigSchema } from './config.js';

const example = parse(readFileSync(resolve(import.meta.dirname, '../../../../../.env.example')));

describe('configuração da API', () => {
  it('aceita o .env.example', () => {
    const config = ConfigSchema.parse(example);
    expect(config.DATABASE_AUTH_URL).toContain('cubetrack_auth');
    expect(config.REALTIME_MODE).toBe('embedded');
    expect(config.COOKIE_DOMAIN).toBeUndefined();
  });

  it('rejeita segredos fracos', () => {
    expect(ConfigSchema.safeParse({ ...example, JWT_SECRET: 'curto' }).success).toBe(false);
    expect(ConfigSchema.safeParse({ ...example, ENCRYPTION_KEY: 'YWJj' }).success).toBe(false);
  });
});
