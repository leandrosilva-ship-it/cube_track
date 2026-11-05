import { Injectable } from '@nestjs/common';
import { schema, type Transaction } from '@cube-track/db';
import type { AuditSearchFilter } from '@cube-track/shared';
import { and, eq, gte, ilike, lt, lte, or, sql, type SQL } from 'drizzle-orm';

const { auditLogs } = schema;

export type AuditLogRow = typeof auditLogs.$inferSelect;

/** `and()`/`or()` só tipam o retorno como `SQL | undefined` por causa do caso de zero argumentos —
 * aqui sempre chamados com 1+, logo sempre definido; checagem em runtime (não um assertion) para
 * passar nos dois lints de null-safety deste projeto sem mascarar um bug real. */
function sqlOrThrow(value: SQL | undefined): SQL {
  if (value === undefined) throw new Error('Condição SQL vazia.');
  return value;
}

export interface AuditKeysetCursor {
  createdAt: Date;
  id: string;
}

/**
 * Busca em `audit_logs` (ADR 0057) — sob RLS normal (tenant corrente), nunca cross-tenant. Keyset
 * manual em `(created_at desc, id desc)` (sem o compilador genérico de filtros de `work/`, que é
 * acoplado ao modelo de itens/colunas); usado tanto pela busca paginada quanto pela exportação
 * (`searchAll`, geradora — nunca materializa o resultado inteiro em memória).
 */
@Injectable()
export class AuditRepository {
  private condition(tenantId: string, filter: AuditSearchFilter): SQL {
    const parts: SQL[] = [eq(auditLogs.tenantId, tenantId)];
    if (filter.from !== undefined) parts.push(gte(auditLogs.createdAt, new Date(filter.from)));
    if (filter.to !== undefined) parts.push(lte(auditLogs.createdAt, new Date(filter.to)));
    if (filter.actorId !== undefined) parts.push(eq(auditLogs.createdBy, filter.actorId));
    if (filter.actorKind !== undefined) parts.push(eq(auditLogs.actorKind, filter.actorKind));
    if (filter.action !== undefined) parts.push(eq(auditLogs.action, filter.action));
    if (filter.entityType !== undefined) parts.push(eq(auditLogs.entityType, filter.entityType));
    if (filter.entityId !== undefined) parts.push(eq(auditLogs.entityId, filter.entityId));
    if (filter.search !== undefined && filter.search.trim() !== '') {
      const term = `%${filter.search.trim()}%`;
      parts.push(sqlOrThrow(or(ilike(auditLogs.action, term), ilike(auditLogs.entityType, term))));
    }
    return sqlOrThrow(and(...parts));
  }

  async searchPage(
    tx: Transaction,
    tenantId: string,
    filter: AuditSearchFilter,
    cursor: AuditKeysetCursor | null,
    limit: number,
  ): Promise<AuditLogRow[]> {
    const conditions = [this.condition(tenantId, filter)];
    if (cursor !== null) {
      conditions.push(
        sqlOrThrow(
          or(
            lt(auditLogs.createdAt, cursor.createdAt),
            and(eq(auditLogs.createdAt, cursor.createdAt), lt(auditLogs.id, cursor.id)),
          ),
        ),
      );
    }
    return tx
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(sql`${auditLogs.createdAt} desc`, sql`${auditLogs.id} desc`)
      .limit(limit);
  }

  /** Geradora: percorre TODAS as páginas via keyset — usada pela exportação em stream (nunca
   * carrega o resultado inteiro em memória, qualquer que seja o tamanho). */
  async *searchAll(
    tx: Transaction,
    tenantId: string,
    filter: AuditSearchFilter,
  ): AsyncGenerator<AuditLogRow> {
    const batchSize = 1_000;
    let cursor: AuditKeysetCursor | null = null;
    for (;;) {
      const batch = await this.searchPage(tx, tenantId, filter, cursor, batchSize);
      for (const row of batch) yield row;
      const last = batch.at(-1);
      if (batch.length < batchSize || last === undefined) return;
      cursor = { createdAt: last.createdAt, id: last.id };
    }
  }
}
