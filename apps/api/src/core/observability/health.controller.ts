import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import type { DatabaseHandle } from '@cube-track/db';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { APP_DB } from '../database/tokens.js';
import { Endpoint } from '../http/endpoint.js';
import { REDIS } from '../redis/redis.module.js';

const HealthSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  checks: z.record(z.string(), z.object({ status: z.enum(['up', 'down']), latencyMs: z.number() })),
});

async function timed(
  check: () => Promise<unknown>,
): Promise<{ status: 'up' | 'down'; latencyMs: number }> {
  const started = performance.now();
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) =>
        setTimeout(() => {
          reject(new Error('timeout'));
        }, 2_000),
      ),
    ]);
    return { status: 'up', latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { status: 'down', latencyMs: Math.round(performance.now() - started) };
  }
}

/** Liveness (processo vivo) e readiness (dependências críticas). Fora do prefixo /v1. */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(APP_DB) private readonly database: DatabaseHandle,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('live')
  @HttpCode(200)
  @Endpoint({ summary: 'Liveness', tags: ['health'], public: true, response: HealthSchema })
  live() {
    return { status: 'ok' as const, checks: {} };
  }

  @Get('ready')
  @Endpoint({
    summary: 'Readiness (PostgreSQL, Redis, Meilisearch)',
    tags: ['health'],
    public: true,
    response: HealthSchema,
    errors: [503],
  })
  async ready(@Res({ passthrough: true }) response: Response) {
    const [postgres, redis, search] = await Promise.all([
      timed(() => this.database.db.execute(sql`select 1`)),
      timed(() => this.redis.ping()),
      timed(async () => {
        const result = await fetch(`${this.config.MEILI_URL}/health`);
        if (!result.ok) throw new Error('meili');
      }),
    ]);
    const critical = postgres.status === 'up' && redis.status === 'up';
    const status = critical ? (search.status === 'up' ? 'ok' : 'degraded') : 'down';
    if (!critical) response.status(503);
    return { status, checks: { postgres, redis, search } } as const;
  }
}
