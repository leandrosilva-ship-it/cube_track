import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { and, desc, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { integrationConnections } = schema;

export type ConnectionRow = typeof integrationConnections.$inferSelect;

export interface ConnectionDto {
  id: string;
  workspaceId: string;
  provider: ConnectionRow['provider'];
  authKind: ConnectionRow['authKind'];
  userId: string | null;
  connectedBy: string | null;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function toConnectionDto(row: ConnectionRow): ConnectionDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider,
    authKind: row.authKind,
    userId: row.userId,
    connectedBy: row.createdBy,
    isActive: row.isActive,
    // Nunca inclui *Ciphertext — só config livre e não sensível (ex.: board padrão do Slack).
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Listagem/desconexão de integrações — comum a todos os provedores (ADR 0056). O cadastro/conexão em
 * si (OAuth, webhook) é específico de cada provedor e vive nos outros serviços deste módulo. */
@Injectable()
export class ConnectionsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async list(user: AuthPrincipal, workspaceId: string): Promise<ConnectionDto[]> {
    await this.access.assert(user, 'integrations.manage', { type: 'workspace', id: workspaceId });
    const rows = await this.runner.tx
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.tenantId, user.tenantId),
          eq(integrationConnections.workspaceId, workspaceId),
          isNull(integrationConnections.deletedAt),
        ),
      )
      .orderBy(desc(integrationConnections.createdAt));
    return rows.map(toConnectionDto);
  }

  async disconnect(user: AuthPrincipal, connectionId: string): Promise<void> {
    const [row] = await this.runner.tx
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, connectionId),
          eq(integrationConnections.tenantId, user.tenantId),
          isNull(integrationConnections.deletedAt),
        ),
      );
    if (row === undefined) throw new NotFoundError('Conexão');
    await this.access.assert(
      user,
      'integrations.manage',
      { type: 'workspace', id: row.workspaceId },
      'Conexão',
    );
    await this.runner.tx
      .update(integrationConnections)
      .set({ isActive: false, deletedAt: new Date() })
      .where(eq(integrationConnections.id, connectionId));
    this.events.recordChange({
      action: 'integration_connection.disconnected',
      entityType: 'integration_connection',
      entityId: row.id,
      before: { provider: row.provider, isActive: row.isActive },
      after: { isActive: false },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'integration_connection.changed',
      aggregateType: 'integration_connection',
      aggregateId: row.id,
      payload: {
        connectionId: row.id,
        workspaceId: row.workspaceId,
        provider: row.provider,
        change: 'disconnected',
      },
      actorId: user.userId,
    });
  }
}
