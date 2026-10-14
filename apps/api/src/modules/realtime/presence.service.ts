import { Inject, Injectable } from '@nestjs/common';
import { PRESENCE_TTL_SECONDS } from '@cube-track/shared';
import type { Redis } from 'ioredis';

import { REDIS } from '../../core/redis/redis.module.js';

export interface PresenceEntry {
  userId: string;
  state: Record<string, unknown>;
}

const ROOMS_KEY = 'presence:rooms';

/**
 * Presença efêmera no Redis (nunca no PostgreSQL): ZSET por room com expiração por membro
 * (`userId:socketId`, score = expira em ms) e HASH com o estado (view aberta, célula em edição…).
 */
@Injectable()
export class PresenceService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private keys(room: string) {
    return { members: `presence:${room}`, state: `presence:${room}:state` };
  }

  /** Registra o heartbeat. Retorna `joined` se o usuário acabou de entrar na room, `updated` se o estado mudou. */
  async heartbeat(
    room: string,
    userId: string,
    socketId: string,
    state: Record<string, unknown>,
  ): Promise<'joined' | 'updated' | 'unchanged'> {
    const { members, state: stateKey } = this.keys(room);
    const member = `${userId}:${socketId}`;
    const wasPresent = await this.userPresent(room, userId);
    const serialized = JSON.stringify(state);
    const previous = await this.redis.hget(stateKey, member);
    await this.redis
      .multi()
      .zadd(members, Date.now() + PRESENCE_TTL_SECONDS * 1000, member)
      .hset(stateKey, member, serialized)
      .expire(members, PRESENCE_TTL_SECONDS * 4)
      .expire(stateKey, PRESENCE_TTL_SECONDS * 4)
      .sadd(ROOMS_KEY, room)
      .exec();
    if (!wasPresent) return 'joined';
    return previous === serialized ? 'unchanged' : 'updated';
  }

  /** Remove o socket; retorna true se o usuário saiu completamente da room. */
  async leave(room: string, userId: string, socketId: string): Promise<boolean> {
    const { members, state } = this.keys(room);
    const member = `${userId}:${socketId}`;
    await this.redis.multi().zrem(members, member).hdel(state, member).exec();
    return !(await this.userPresent(room, userId));
  }

  async list(room: string): Promise<PresenceEntry[]> {
    const { members, state } = this.keys(room);
    const active = await this.redis.zrangebyscore(members, Date.now(), '+inf');
    if (active.length === 0) return [];
    const states = await this.redis.hmget(state, ...active);
    const byUser = new Map<string, PresenceEntry>();
    active.forEach((member, index) => {
      const userId = member.split(':')[0] ?? member;
      byUser.set(userId, {
        userId,
        state: JSON.parse(states[index] ?? '{}') as Record<string, unknown>,
      });
    });
    return [...byUser.values()];
  }

  /** Remove membros expirados; retorna [room, userId] dos usuários que saíram. Executado por um único nó. */
  async sweep(): Promise<[string, string][]> {
    const lock = await this.redis.set('presence:sweep-lock', '1', 'EX', 5, 'NX');
    if (lock !== 'OK') return [];
    const left: [string, string][] = [];
    for (const room of await this.redis.smembers(ROOMS_KEY)) {
      const { members, state } = this.keys(room);
      const expired = await this.redis.zrangebyscore(members, '-inf', Date.now());
      if (expired.length > 0) {
        await this.redis
          .multi()
          .zrem(members, ...expired)
          .hdel(state, ...expired)
          .exec();
        for (const userId of new Set(expired.map((member) => member.split(':')[0] ?? member))) {
          if (!(await this.userPresent(room, userId))) left.push([room, userId]);
        }
      }
      if ((await this.redis.zcard(members)) === 0) await this.redis.srem(ROOMS_KEY, room);
    }
    return left;
  }

  private async userPresent(room: string, userId: string): Promise<boolean> {
    const active = await this.redis.zrangebyscore(this.keys(room).members, Date.now(), '+inf');
    return active.some((member) => member.startsWith(`${userId}:`));
  }
}
