import { outboxRowToMessage, schema, type DatabaseHandle } from '@cube-track/db';
import { EVENT_CONSUMERS, REALTIME_CHANNEL, type DomainEventJob } from '@cube-track/shared';
import { and, asc, inArray, isNull, isNotNull, lt, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { Logger } from './logger.js';
import type { QueueRegistry } from './queues.js';

const { outboxEvents } = schema;

/**
 * Relay do outbox (ADR 0012/0027): garante a entrega de todo evento gravado, mesmo se o fast path da
 * API falhou. Lê lotes com `FOR UPDATE SKIP LOCKED` (várias réplicas em paralelo), publica no canal
 * realtime, despacha para as filas consumidoras (jobId determinístico = deduplicação) e marca como
 * publicado — tudo na mesma transação do papel `app_relay`.
 */
export class OutboxRelay {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private lastPurge = 0;

  constructor(
    private readonly database: DatabaseHandle,
    private readonly redis: Redis,
    private readonly queues: QueueRegistry,
    private readonly logger: Logger,
    private readonly options: { pollMs: number; batchSize: number; retentionDays: number },
  ) {}

  start(): void {
    const tick = async () => {
      try {
        let processed: number;
        do processed = await this.runOnce();
        while (processed === this.options.batchSize);
        await this.purgeIfDue();
      } catch (error) {
        this.logger.error({ err: error }, 'Falha no relay do outbox');
      } finally {
        if (this.running) this.timer = setTimeout(() => void tick(), this.options.pollMs);
      }
    };
    this.running = true;
    void tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
  }

  /** Processa um lote; retorna quantos eventos foram despachados. */
  async runOnce(): Promise<number> {
    return this.database.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(outboxEvents)
        .where(isNull(outboxEvents.publishedAt))
        .orderBy(asc(outboxEvents.createdAt))
        .limit(this.options.batchSize)
        .for('update', { skipLocked: true });
      if (rows.length === 0) return 0;

      const pipeline = this.redis.pipeline();
      for (const row of rows)
        pipeline.publish(REALTIME_CHANNEL, JSON.stringify(outboxRowToMessage(row)));
      await pipeline.exec();

      for (const row of rows) {
        const consumers = EVENT_CONSUMERS[row.eventType] ?? [];
        if (consumers.length === 0) continue;
        const job: DomainEventJob = {
          eventId: row.id,
          tenantId: row.tenantId,
          type: row.eventType,
          boardId: row.boardId,
          itemId: row.itemId,
          actorId: row.actorId,
          actorKind: row.actorKind,
          depth: row.depth,
          payload: row.payload,
        };
        await Promise.all(
          consumers.map((queue) =>
            this.queues[queue].add(row.eventType, job, { jobId: `${row.id}.${queue}` }),
          ),
        );
      }

      await tx
        .update(outboxEvents)
        .set({ publishedAt: sql`now()` })
        .where(
          inArray(
            outboxEvents.id,
            rows.map((row) => row.id),
          ),
        );
      return rows.length;
    });
  }

  /** Remove eventos publicados além da retenção (o outbox também é o log de replay realtime). */
  async purge(): Promise<number> {
    const removed = await this.database.db
      .delete(outboxEvents)
      .where(
        and(
          isNotNull(outboxEvents.publishedAt),
          lt(
            outboxEvents.createdAt,
            sql`now() - make_interval(days => ${this.options.retentionDays})`,
          ),
        ),
      )
      .returning({ id: outboxEvents.id });
    return removed.length;
  }

  private async purgeIfDue(): Promise<void> {
    if (Date.now() - this.lastPurge < 3_600_000) return;
    this.lastPurge = Date.now();
    const removed = await this.purge();
    if (removed > 0) this.logger.info({ removed }, 'Eventos antigos do outbox removidos');
  }
}
