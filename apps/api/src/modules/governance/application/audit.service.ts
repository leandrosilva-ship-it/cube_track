import { Injectable } from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  type AuditSearchFilter,
  type Page,
} from '@cube-track/shared';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ValidationError } from '../../../core/errors/problems.js';
import { AccessService } from '../../access/application/access.service.js';
import { AuditRepository, type AuditLogRow } from '../infrastructure/audit.repository.js';

export interface AuditEntryDto {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorKind: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  metadata: Record<string, unknown>;
}

const SORT_SIGNATURE = 'created_at:desc,id:desc';
const CSV_BOM = String.fromCharCode(0xfeff);
const CSV_HEADER = ['id', 'created_at', 'actor_id', 'actor_kind', 'action', 'entity_type', 'entity_id', 'ip'];

function csvEscape(value: string): string {
  return /["\n\r;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvLine(entry: AuditEntryDto): string {
  return [
    entry.id,
    entry.createdAt,
    entry.actorId ?? '',
    entry.actorKind,
    entry.action,
    entry.entityType,
    entry.entityId ?? '',
    entry.ip ?? '',
  ]
    .map(csvEscape)
    .join(';');
}

function toDto(row: AuditLogRow): AuditEntryDto {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    actorId: row.createdBy,
    actorKind: row.actorKind,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.before,
    after: row.after,
    ip: row.ip,
    metadata: row.metadata,
  };
}

/** Busca/exportação avançada de auditoria (ADR 0057) — a trilha em si (`audit_logs`,
 * `appendAuditLog`) já existe desde o Prompt 2; este módulo é só um leitor por cima dela. */
@Injectable()
export class AuditService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly repository: AuditRepository,
  ) {}

  async search(
    user: AuthPrincipal,
    filter: AuditSearchFilter,
    limit: number,
    cursorRaw: string | undefined,
  ): Promise<Page<AuditEntryDto>> {
    await this.access.assert(user, 'audit.read', { type: 'tenant' });
    const cursor =
      cursorRaw === undefined
        ? null
        : (() => {
            const decoded = decodeCursor(cursorRaw, SORT_SIGNATURE);
            if (decoded === null)
              throw new ValidationError([{ path: 'query.cursor', message: 'Cursor inválido.' }]);
            const [createdAtRaw] = decoded.keys;
            if (typeof createdAtRaw !== 'string') {
              throw new ValidationError([{ path: 'query.cursor', message: 'Cursor inválido.' }]);
            }
            return { createdAt: new Date(createdAtRaw), id: decoded.id };
          })();
    const rows = await this.repository.searchPage(this.runner.tx, user.tenantId, filter, cursor, limit + 1);
    const page = rows.slice(0, limit);
    const hasNextPage = rows.length > limit;
    const last = page.at(-1);
    return {
      data: page.map(toDto),
      pageInfo: {
        hasNextPage,
        nextCursor:
          hasNextPage && last !== undefined
            ? encodeCursor({ sort: SORT_SIGNATURE, keys: [last.createdAt.toISOString()], id: last.id })
            : null,
      },
    };
  }

  /**
   * Escreve a exportação diretamente na resposta HTTP, linha a linha (nunca materializa o resultado
   * inteiro em memória) — e só retorna quando a última linha foi escrita. Isso é proposital: a
   * transação desta requisição (`this.runner.tx`) fecha assim que o MÉTODO DO CONTROLLER retorna
   * (`TransactionInterceptor`), então o cursor no banco só pode ficar aberto enquanto este método
   * (chamado com `await` pelo controller) ainda não retornou — ao contrário de devolver uma geradora
   * para o controller consumir depois (quando a transação já teria fechado).
   */
  async streamExport(
    user: AuthPrincipal,
    filter: AuditSearchFilter,
    format: 'csv' | 'ndjson',
    write: (chunk: string) => void,
  ): Promise<void> {
    await this.access.assert(user, 'audit.export', { type: 'tenant' });
    if (format === 'csv') write(`${CSV_BOM}${CSV_HEADER.join(';')}\r\n`);
    for await (const row of this.repository.searchAll(this.runner.tx, user.tenantId, filter)) {
      const entry = toDto(row);
      write(format === 'csv' ? `${csvLine(entry)}\r\n` : `${JSON.stringify(entry)}\n`);
    }
  }
}
