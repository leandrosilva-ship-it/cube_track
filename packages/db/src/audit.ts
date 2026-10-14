import { sql } from 'drizzle-orm';

import type { Transaction } from './client.js';

export type AuditActorKind = 'user' | 'automation' | 'api' | 'import' | 'system';

export interface AuditEntry {
  tenantId: string;
  actorId?: string | null;
  actorKind?: AuditActorKind;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

const toJson = (value: unknown): string | null =>
  value === undefined || value === null ? null : JSON.stringify(value);

/**
 * Registra um evento na trilha de auditoria (ADR 0015). `chain_seq`, `prev_hash` e `hash`
 * são calculados pelo trigger `app.audit_logs_chain`. Deve ser chamado na mesma transação da mudança.
 */
export async function appendAuditLog(tx: Transaction, entry: AuditEntry): Promise<void> {
  await tx.execute(sql`
    insert into audit_logs
      (tenant_id, created_by, actor_kind, action, entity_type, entity_id, before, after, ip, user_agent, request_id, metadata)
    values (
      ${entry.tenantId}::uuid,
      ${entry.actorId ?? null}::uuid,
      ${entry.actorKind ?? 'user'}::actor_kind,
      ${entry.action},
      ${entry.entityType},
      ${entry.entityId ?? null}::uuid,
      ${toJson(entry.before)}::jsonb,
      ${toJson(entry.after)}::jsonb,
      ${entry.ip ?? null}::inet,
      ${entry.userAgent ?? null},
      ${entry.requestId ?? null},
      ${JSON.stringify(entry.metadata ?? {})}::jsonb
    )
  `);
}
