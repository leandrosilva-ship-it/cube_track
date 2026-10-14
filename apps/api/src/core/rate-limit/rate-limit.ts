import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { requireContext } from '../context/request-context.js';
import { RateLimitError } from '../errors/problems.js';
import { httpPair } from '../http/execution.js';
import { REDIS } from '../redis/redis.module.js';

export interface RateLimitPolicy {
  /** Requisições permitidas por janela. */
  limit: number;
  windowSeconds: number;
  /** Chave da janela: usuário autenticado, IP, ou IP + campo `email` do corpo (anti força bruta). */
  by: 'user' | 'ip' | 'ip+email';
  /** Nome do grupo de limite (padrão: rota). */
  bucket?: string;
}

export const RATE_LIMIT_METADATA = 'cube:rate-limit';
export const RateLimit = (policy: RateLimitPolicy) => SetMetadata(RATE_LIMIT_METADATA, policy);

// INCR + EXPIRE atômicos; retorna [contador, ttl restante].
const SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return { current, redis.call('TTL', KEYS[1]) }
`;

/** Limite de requisições em janela fixa no Redis (compartilhado entre réplicas). */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const pair = httpPair(context);
    if (pair === null) return true;
    const custom = this.reflector.getAllAndOverride<RateLimitPolicy | undefined>(
      RATE_LIMIT_METADATA,
      [context.getHandler(), context.getClass()],
    );
    const policy: RateLimitPolicy = custom ?? {
      limit: this.config.RATE_LIMIT_PER_MINUTE,
      windowSeconds: 60,
      by: 'user',
      bucket: 'global',
    };
    const store = requireContext();
    const principalKey =
      store.principal === null ? `ip:${store.ip ?? 'unknown'}` : `u:${store.principal.userId}`;
    let identity: string;
    if (policy.by === 'user') identity = principalKey;
    else if (policy.by === 'ip') identity = `ip:${store.ip ?? 'unknown'}`;
    else {
      const body = pair.request.body as { email?: unknown } | undefined;
      const email = typeof body?.email === 'string' ? body.email.toLowerCase() : '';
      identity = `ip:${store.ip ?? 'unknown'}:e:${email}`;
    }
    const bucket = policy.bucket ?? `${context.getClass().name}.${context.getHandler().name}`;
    const window = Math.floor(Date.now() / 1000 / policy.windowSeconds);
    const key = `rl:${bucket}:${identity}:${window}`;
    const [count, ttl] = (await this.redis.eval(SCRIPT, 1, key, String(policy.windowSeconds))) as [
      number,
      number,
    ];
    const remaining = Math.max(0, policy.limit - count);
    const reset = ttl > 0 ? ttl : policy.windowSeconds;
    pair.response.setHeader('RateLimit-Limit', String(policy.limit));
    pair.response.setHeader('RateLimit-Remaining', String(remaining));
    pair.response.setHeader('RateLimit-Reset', String(reset));
    if (count > policy.limit) throw new RateLimitError(reset);
    return true;
  }
}
