import { createHmac } from 'node:crypto';

import { schema, withTenant, type DatabaseHandle } from '@cube-track/db';
import {
  DomainEventJobSchema,
  WebhookDeliveryJobSchema,
  type DomainEventJob,
} from '@cube-track/shared';
import { decryptSecret } from '@cube-track/shared/crypto';
import type { Job, Queue } from 'bullmq';
import { and, eq, isNull, or, sql } from 'drizzle-orm';

import type { Logger } from '../logger.js';

const { webhooks, webhookDeliveries, boards } = schema;

type WebhookRow = typeof webhooks.$inferSelect;

const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BODY_CHARS = 4_000;
/** Desabilita o webhook após esta quantidade de eventos seguidos com todas as tentativas esgotadas. */
const MAX_CONSECUTIVE_FAILURES = 10;

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Fan-out (fila `webhooks`, um job por evento durável do outbox): resolve os webhooks habilitados
 * cuja lista `events` inclui o tipo do evento e cujo escopo bate (board exato, ou workspace inteiro
 * quando `boardId` do webhook é nulo) e despacha uma entrega independente (fila `webhook-deliveries`,
 * `jobId` determinístico) para cada um — assim, a retentativa de um webhook não reenvia aos demais
 * nem duplica entregas já bem-sucedidas. Escopo (ADR 0051): só eventos de board (`boardId` presente);
 * eventos de workspace/tenant sem board não disparam webhooks nesta entrega.
 */
export function webhookFanoutProcessor(deps: {
  database: DatabaseHandle;
  deliveryQueue: Queue;
  logger: Logger;
}) {
  return async function dispatchWebhooks(job: Job): Promise<{ dispatched: number }> {
    const event = DomainEventJobSchema.parse(job.data);
    if (event.boardId === null) return { dispatched: 0 };
    const boardId = event.boardId;

    return withTenant(deps.database.db, { tenantId: event.tenantId, userId: null }, async (tx) => {
      const [board] = await tx
        .select({ workspaceId: boards.workspaceId })
        .from(boards)
        .where(eq(boards.id, boardId));
      if (board === undefined) return { dispatched: 0 };
      const rows = await tx
        .select({ id: webhooks.id })
        .from(webhooks)
        .where(
          and(
            eq(webhooks.isEnabled, true),
            isNull(webhooks.deletedAt),
            sql`${webhooks.events} @> ARRAY[${event.type}]::text[]`,
            or(
              eq(webhooks.boardId, boardId),
              and(isNull(webhooks.boardId), eq(webhooks.workspaceId, board.workspaceId)),
            ),
          ),
        );
      await Promise.all(
        rows.map((webhook) =>
          deps.deliveryQueue.add(
            event.type,
            { webhookId: webhook.id, event },
            { jobId: `${event.eventId}.${webhook.id}` },
          ),
        ),
      );
      return { dispatched: rows.length };
    });
  };
}

/**
 * Entrega de um webhook (fila `webhook-deliveries`, um job por par evento+webhook): assina o corpo
 * (HMAC-SHA256 do segredo decifrado) no cabeçalho `X-CubeTrack-Signature`, grava o resultado em
 * `webhook_deliveries` (idempotente por `webhookId`+`eventId`) e relança o erro para a retentativa
 * exponencial padrão do BullMQ. Na última tentativa sem sucesso, soma `consecutiveFailures`; ao
 * atingir o limite, desabilita o webhook (`isEnabled: false`, `disabledAt`).
 */
export function webhookDeliveryProcessor(deps: {
  database: DatabaseHandle;
  encryptionKey: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
}) {
  const doFetch = deps.fetchImpl ?? fetch;
  return async function deliverWebhook(job: Job): Promise<{ status: 'succeeded' | 'failed' }> {
    const { webhookId, event } = WebhookDeliveryJobSchema.parse(job.data);
    return withTenant(
      deps.database.db,
      { tenantId: event.tenantId, userId: null },
      async (tx) => {
        const [webhook] = await tx
          .select()
          .from(webhooks)
          .where(and(eq(webhooks.id, webhookId), isNull(webhooks.deletedAt)))
          .for('update');
        if (webhook?.isEnabled !== true) return { status: 'succeeded' as const };

        const attempt = job.attemptsMade + 1;
        const maxAttempts = job.opts.attempts ?? 1;
        const isFinalAttempt = attempt >= maxAttempts;
        const result = await attemptDelivery(webhook, event, deps.encryptionKey, doFetch);

        await tx
          .insert(webhookDeliveries)
          .values({
            tenantId: webhook.tenantId,
            webhookId: webhook.id,
            eventId: event.eventId,
            eventType: event.type,
            payload: event.payload,
            status: result.success ? 'succeeded' : isFinalAttempt ? 'dead' : 'failed',
            attempt,
            responseStatus: result.responseStatus,
            responseBody: result.responseBody,
            error: result.error,
            durationMs: result.durationMs,
            deliveredAt: result.success ? new Date() : null,
          })
          .onConflictDoUpdate({
            target: [webhookDeliveries.webhookId, webhookDeliveries.eventId],
            set: {
              status: result.success ? 'succeeded' : isFinalAttempt ? 'dead' : 'failed',
              attempt,
              responseStatus: result.responseStatus,
              responseBody: result.responseBody,
              error: result.error,
              durationMs: result.durationMs,
              deliveredAt: result.success ? new Date() : null,
            },
          });

        if (result.success) {
          if (webhook.consecutiveFailures > 0)
            await tx.update(webhooks).set({ consecutiveFailures: 0 }).where(eq(webhooks.id, webhook.id));
          return { status: 'succeeded' as const };
        }

        if (isFinalAttempt) {
          const consecutiveFailures = webhook.consecutiveFailures + 1;
          const disable = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
          await tx
            .update(webhooks)
            .set({
              consecutiveFailures,
              ...(disable ? { isEnabled: false, disabledAt: new Date() } : {}),
            })
            .where(eq(webhooks.id, webhook.id));
          if (disable) {
            deps.logger.warn(
              { webhookId: webhook.id, consecutiveFailures },
              'Webhook desabilitado após falhas consecutivas',
            );
          }
          // Última tentativa já esgotada: não relança (evitaria uma 6ª tentativa inexistente).
          return { status: 'failed' as const };
        }
        throw new Error(result.error ?? `Entrega falhou (HTTP ${result.responseStatus ?? '-'})`);
      },
    );
  };
}

interface DeliveryAttemptResult {
  success: boolean;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number;
}

async function attemptDelivery(
  webhook: WebhookRow,
  event: DomainEventJob,
  encryptionKey: string,
  doFetch: typeof fetch,
): Promise<DeliveryAttemptResult> {
  const startedAt = Date.now();
  const body = JSON.stringify({
    eventId: event.eventId,
    type: event.type,
    occurredAt: new Date().toISOString(),
    payload: event.payload,
  });
  let secret: string;
  try {
    secret = decryptSecret(webhook.secretCiphertext, encryptionKey);
  } catch (error) {
    return {
      success: false,
      responseStatus: null,
      responseBody: null,
      error: `Segredo inválido: ${error instanceof Error ? error.message : String(error)}`,
      durationMs: Date.now() - startedAt,
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, DELIVERY_TIMEOUT_MS);
  try {
    const response = await doFetch(webhook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cubetrack-event': event.type,
        'x-cubetrack-delivery': event.eventId,
        'x-cubetrack-signature': sign(secret, body),
        ...webhook.headers,
      },
      body,
      signal: controller.signal,
    });
    const responseBody = (await response.text()).slice(0, MAX_RESPONSE_BODY_CHARS);
    return {
      success: response.ok,
      responseStatus: response.status,
      responseBody,
      error: response.ok ? null : `HTTP ${response.status}`,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      success: false,
      responseStatus: null,
      responseBody: null,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}
