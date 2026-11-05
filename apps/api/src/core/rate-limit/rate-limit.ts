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
  /** Chave da janela: usuário autenticado, IP, IP + campo `email` do corpo (anti força bruta), ou o
   * token de API/app OAuth da requisição (ADR 0056). */
  by: 'user' | 'ip' | 'ip+email' | 'token';
  /** Nome do grupo de limite (padrão: rota). */
  bucket?: string;
}

export const RATE_LIMIT_METADATA = 'cube:rate-limit';
export const RateLimit = (policy: RateLimitPolicy) => SetMetadata(RATE_LIMIT_METADATA, policy);

/**
 * Teto padrão por token de API (ADR 0056), em cima de qualquer limite normal da rota: 300
 * requisições/minuto — folga confortável para uso automatizado legítimo (um script sincronizando um
 * board inteiro, por exemplo) e, ainda assim, baixo o bastante para conter um token vazado ou um
 * integrador com bug de retentativa em loop antes que vire um incidente. Não é configurável por
 * tenant nesta entrega — um teto global simples, documentado aqui.
 */
export const API_TOKEN_RATE_LIMIT: RateLimitPolicy = {
  limit: 300,
  windowSeconds: 60,
  by: 'token',
  bucket: 'api-token',
};

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
    const bucket = policy.bucket ?? `${context.getClass().name}.${context.getHandler().name}`;
    await this.enforce(policy, bucket, store, pair);
    // Teto adicional por token de API (ADR 0056), por cima do limite normal da rota — nunca o
    // substitui, só soma mais uma trava quando a requisição veio autenticada por token.
    if (store.principal?.authKind === 'api_token') {
      await this.enforce(API_TOKEN_RATE_LIMIT, API_TOKEN_RATE_LIMIT.bucket ?? 'api-token', store, pair);
    }
    return true;
  }

  private async enforce(
    policy: RateLimitPolicy,
    bucket: string,
    store: ReturnType<typeof requireContext>,
    pair: NonNullable<ReturnType<typeof httpPair>>,
  ): Promise<void> {
    let identity: string;
    if (policy.by === 'token') {
      identity = `tok:${store.principal?.apiTokenId ?? 'unknown'}`;
    } else if (policy.by === 'user') {
      identity =
        store.principal === null ? `ip:${store.ip ?? 'unknown'}` : `u:${store.principal.userId}`;
    } else if (policy.by === 'ip') {
      identity = `ip:${store.ip ?? 'unknown'}`;
    } else {
      const body = pair.request.body as { email?: unknown } | undefined;
      const email = typeof body?.email === 'string' ? body.email.toLowerCase() : '';
      identity = `ip:${store.ip ?? 'unknown'}:e:${email}`;
    }
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
  }
}
