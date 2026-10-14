import { Inject, Injectable, Logger } from '@nestjs/common';
import { REALTIME_CHANNEL, type RealtimeTransportMessage } from '@cube-track/shared';
import type { Redis } from 'ioredis';

import { REDIS } from '../redis/redis.module.js';

/**
 * Fast path realtime: publica no Redis logo após o commit. A garantia de entrega é do relay do
 * outbox no worker; os nós realtime deduplicam por `eventId` (ADR 0027).
 */
@Injectable()
export class EventPublisher {
  private readonly logger = new Logger(EventPublisher.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async publish(messages: readonly RealtimeTransportMessage[]): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      for (const message of messages) pipeline.publish(REALTIME_CHANNEL, JSON.stringify(message));
      await pipeline.exec();
    } catch (error) {
      // Falha no fast path não perde o evento: o relay do outbox o publicará.
      this.logger.warn(
        { err: error },
        'Falha ao publicar eventos realtime (o relay do outbox fará a entrega)',
      );
    }
  }
}
