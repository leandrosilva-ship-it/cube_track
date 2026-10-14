import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from 'dotenv';
import { describe, expect, it } from 'vitest';

import { loadWorkerConfig, redisConnection } from './config.js';

const example = parse(readFileSync(resolve(import.meta.dirname, '../../../.env.example')));

describe('configuração do worker', () => {
  it('aceita o .env.example', () => {
    const config = loadWorkerConfig({ ...example });
    expect(config.DATABASE_RELAY_URL).toContain('cubetrack_relay');
    expect(config.ANTIVIRUS_MODE).toBe('disabled');
    expect(config.BOARD_PORT).toBe(3010);
  });

  it('proíbe antivírus desativado em produção e exige URLs do banco', () => {
    expect(() => loadWorkerConfig({ ...example, NODE_ENV: 'production' })).toThrow(
      /ANTIVIRUS_MODE=disabled/,
    );
    expect(() => loadWorkerConfig({ ...example, DATABASE_RELAY_URL: '' })).toThrow(
      /DATABASE_RELAY_URL/,
    );
  });

  it('converte a URL do Redis em opções do BullMQ', () => {
    expect(redisConnection('redis://:s%40nha@cache:6380/4')).toEqual({
      host: 'cache',
      port: 6380,
      db: 4,
      password: 's@nha',
      maxRetriesPerRequest: null,
    });
  });
});
