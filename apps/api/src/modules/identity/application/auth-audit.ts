import { Injectable, Logger } from '@nestjs/common';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import type { SessionRecord } from '../infrastructure/identity.repository.js';

/**
 * Auditoria dos fluxos de autenticação (rotas `@Audited({ transactional: false })`): grava no tenant
 * em que o evento ocorreu. Eventos sem tenant identificável (ex.: e-mail inexistente) vão apenas para
 * o log de segurança estruturado.
 */
@Injectable()
export class AuthAudit {
  private readonly logger = new Logger('SecurityAudit');

  constructor(
    private readonly runner: TransactionRunner,
    private readonly events: DomainEvents,
  ) {}

  async record(
    tenantId: string,
    userId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.runner.run({ tenantId, userId }, () => {
      this.events.recordChange({ action, entityType, entityId, metadata });
      return Promise.resolve();
    });
  }

  securityLog(event: string, details: Record<string, unknown>): void {
    this.logger.warn({ securityEvent: event, ...details }, event);
  }

  /** Notifica os sockets das sessões revogadas (room do usuário) para desconectá-los. */
  async sessionsRevoked(sessions: readonly SessionRecord[]): Promise<void> {
    for (const session of sessions) {
      await this.runner.run({ tenantId: session.tenantId, userId: session.userId }, async () => {
        await this.events.emit({
          tenantId: session.tenantId,
          type: 'session.revoked',
          aggregateType: 'session',
          aggregateId: session.id,
          userId: session.userId,
          payload: { sessionId: session.id },
          actorId: session.userId,
          actorKind: 'system',
        });
      });
    }
  }
}
