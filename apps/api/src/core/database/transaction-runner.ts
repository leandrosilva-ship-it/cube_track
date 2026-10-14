import { Inject, Injectable } from '@nestjs/common';
import {
  appendAuditLog,
  schema,
  withTenant,
  type DatabaseHandle,
  type Transaction,
} from '@cube-track/db';
import { newId } from '@cube-track/shared';
import { sql } from 'drizzle-orm';

import {
  createContextStore,
  currentContext,
  requireContext,
  runWithContext,
  type ChangeRecord,
  type RequestContextStore,
} from '../context/request-context.js';
import { EventPublisher } from '../events/event-publisher.js';
import { APP_DB } from './tokens.js';

export interface TenantScope {
  tenantId: string;
  userId: string | null;
  actorKind?: 'user' | 'automation' | 'api' | 'import' | 'system';
}

export interface RunOptions {
  readOnly?: boolean;
  /** Auditoria registrada mesmo quando o caso de uso não registra mudanças explícitas. */
  fallbackAudit?: { action: string; entityType: string; entityId?: string | null };
}

/**
 * Unidade de trabalho: abre a transação com contexto de tenant (RLS), executa o caso de uso,
 * grava auditoria + log de atividade das mudanças registradas e, após o commit, publica os eventos
 * realtime (fast path). Os eventos já foram gravados no outbox dentro da mesma transação.
 */
@Injectable()
export class TransactionRunner {
  constructor(
    @Inject(APP_DB) private readonly database: DatabaseHandle,
    private readonly publisher: EventPublisher,
  ) {}

  async run<T>(scope: TenantScope, work: () => Promise<T>, options: RunOptions = {}): Promise<T> {
    const existing = currentContext();
    if (existing?.tx !== null && existing?.tx !== undefined) return work();
    const store = existing ?? createContextStore({ requestId: newId() });
    return runWithContext(store, async () => {
      const result = await withTenant(
        this.database.db,
        { tenantId: scope.tenantId, userId: scope.userId },
        async (tx) => {
          if (options.readOnly === true) await tx.execute(sql`set transaction read only`);
          store.tx = tx;
          try {
            const value = await work();
            if (options.readOnly !== true) await this.flushChanges(tx, store, scope, options);
            return value;
          } catch (error) {
            store.afterCommit.length = 0;
            store.published.length = 0;
            store.changes.length = 0;
            throw error;
          } finally {
            store.tx = null;
          }
        },
      );
      const hooks = store.afterCommit.splice(0);
      for (const hook of hooks) await hook();
      const messages = store.published.splice(0);
      if (messages.length > 0) await this.publisher.publish(messages);
      return result;
    });
  }

  /** Transação corrente (dentro de `run`). */
  get tx(): Transaction {
    const tx = requireContext().tx;
    if (tx === null) throw new Error('Operação de dados fora de uma unidade de trabalho');
    return tx;
  }

  private async flushChanges(
    tx: Transaction,
    store: RequestContextStore,
    scope: TenantScope,
    options: RunOptions,
  ): Promise<void> {
    const changes: ChangeRecord[] = store.changes.splice(0);
    if (changes.length === 0 && options.fallbackAudit !== undefined) {
      changes.push({
        action: options.fallbackAudit.action,
        entityType: options.fallbackAudit.entityType,
        entityId: options.fallbackAudit.entityId ?? null,
      });
    }
    for (const change of changes) {
      await appendAuditLog(tx, {
        tenantId: scope.tenantId,
        actorId: scope.userId,
        actorKind: scope.actorKind ?? 'user',
        action: change.action,
        entityType: change.entityType,
        entityId: change.entityId,
        before: change.before,
        after: change.after,
        ip: store.ip,
        userAgent: store.userAgent,
        requestId: store.requestId,
        metadata: change.metadata ?? {},
      });
      const entityId = change.entityId;
      if (change.activity !== undefined && change.activity.length > 0 && entityId !== null) {
        await tx.insert(schema.activityLogs).values(
          change.activity.map((entry) => ({
            tenantId: scope.tenantId,
            boardId: change.boardId ?? null,
            itemId: change.itemId ?? null,
            actorId: scope.userId,
            actorKind: scope.actorKind ?? 'user',
            action: entry.action,
            entityType: change.entityType,
            entityId,
            columnKey: entry.columnKey ?? null,
            oldValue: entry.oldValue ?? null,
            newValue: entry.newValue ?? null,
            metadata: { requestId: store.requestId },
            createdBy: scope.userId,
          })),
        );
      }
    }
  }
}
