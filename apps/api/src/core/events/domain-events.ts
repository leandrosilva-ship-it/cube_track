import { Injectable } from '@nestjs/common';
import { appendOutboxEvent, type OutboxEventInput } from '@cube-track/db';
import type { RealtimeEventType } from '@cube-track/shared';

import { requireContext, type ChangeRecord } from '../context/request-context.js';
import { TransactionRunner } from '../database/transaction-runner.js';

/** Registro de mudanças (auditoria) e eventos (outbox) dentro da unidade de trabalho corrente. */
@Injectable()
export class DomainEvents {
  constructor(private readonly runner: TransactionRunner) {}

  recordChange(change: ChangeRecord): void {
    requireContext().changes.push(change);
  }

  async emit<T extends RealtimeEventType>(
    input: Omit<OutboxEventInput<T>, 'clientMutationId' | 'correlationId'>,
  ): Promise<void> {
    const store = requireContext();
    const message = await appendOutboxEvent(this.runner.tx, {
      ...input,
      clientMutationId: store.clientMutationId,
      correlationId: store.requestId,
    });
    store.published.push(message);
  }
}
