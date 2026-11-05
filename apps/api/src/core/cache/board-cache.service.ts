import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { currentContext } from '../context/request-context.js';
import { appMetrics } from '../observability/metrics.js';
import { REDIS } from '../redis/redis.module.js';

const CACHE_TTL_SECONDS = 60;

/**
 * Cache de metadados de board (forma tenant-wide: linha do board, grupos, definições de coluna,
 * rótulos e opções — nunca dados dependentes de usuário como permissões/colunas ocultas/`canEdit`,
 * que continuam calculados a cada requisição). Mesmo padrão versionado do cache de permissões
 * (`AccessService`, ADR 0030/Prompt 3): uma versão por board em `board:{boardId}:v`, incrementada a
 * cada mutação de board/coluna/grupo/rótulo/opção, chave de cache `board:{boardId}:{version}:{key}`.
 * TTL curto como rede de segurança caso algum ponto de mutação futuro esqueça de invalidar.
 */
@Injectable()
export class BoardCacheService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async cached<T>(boardId: string, key: string, load: () => Promise<T>): Promise<T> {
    const version = (await this.redis.get(`board:${boardId}:v`)) ?? '0';
    const cacheKey = `board:${boardId}:${version}:${key}`;
    const hit = await this.redis.get(cacheKey);
    if (hit !== null) {
      appMetrics.boardCacheHits.add(1);
      return JSON.parse(hit) as T;
    }
    appMetrics.boardCacheMisses.add(1);
    const value = await load();
    await this.redis.set(cacheKey, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
    return value;
  }

  /** Invalida a forma cacheada de um board (incrementa a versão). */
  async invalidate(boardId: string): Promise<void> {
    const bump = async (): Promise<void> => {
      await this.redis.incr(`board:${boardId}:v`);
    };
    const store = currentContext();
    // Dentro de uma transação, invalida só após o commit (evita recachear dados antigos).
    if (store?.tx !== null && store?.tx !== undefined) store.afterCommit.push(bump);
    else await bump();
  }
}
