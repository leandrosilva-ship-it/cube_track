import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { defaultHealthRules, type HealthRule } from '@cube-track/shared';
import { and, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { primaryWorkspaceId } from '../../resources/application/workspace-scope.js';

const { healthRuleSets } = schema;

export interface HealthRuleSetDto {
  id: string;
  boardId: string | null;
  rules: HealthRule[];
}

/**
 * Regras de saúde (RAG automático, ADR 0053): conjunto por board ou padrão do tenant (`boardId`
 * nulo). `boardId` nulo é administrado por `portfolio.manage` (afeta todo tenant sem board próprio);
 * por board, `board.manage`.
 */
@Injectable()
export class HealthRulesService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async getForBoard(user: AuthPrincipal, boardId: string): Promise<HealthRuleSetDto> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const [row] = await this.runner.tx
      .select()
      .from(healthRuleSets)
      .where(and(eq(healthRuleSets.boardId, boardId), isNull(healthRuleSets.deletedAt)));
    if (row !== undefined) return { id: row.id, boardId: row.boardId, rules: row.rules };
    return this.getDefault(user);
  }

  async setForBoard(user: AuthPrincipal, boardId: string, rules: HealthRule[]): Promise<HealthRuleSetDto> {
    await this.access.assert(user, 'board.manage', { type: 'board', id: boardId }, 'Board');
    return this.upsert(user, boardId, rules);
  }

  async getDefault(user: AuthPrincipal): Promise<HealthRuleSetDto> {
    const workspaceId = await primaryWorkspaceId(this.runner.tx, user.tenantId);
    await this.access.assert(user, 'workspace.read', { type: 'workspace', id: workspaceId }, 'Workspace');
    const [row] = await this.runner.tx
      .select()
      .from(healthRuleSets)
      .where(and(isNull(healthRuleSets.boardId), isNull(healthRuleSets.deletedAt)));
    if (row !== undefined) return { id: row.id, boardId: null, rules: row.rules };
    return { id: '', boardId: null, rules: defaultHealthRules() };
  }

  async setDefault(user: AuthPrincipal, rules: HealthRule[]): Promise<HealthRuleSetDto> {
    const workspaceId = await primaryWorkspaceId(this.runner.tx, user.tenantId);
    await this.access.assert(user, 'portfolio.manage', { type: 'workspace', id: workspaceId }, 'Workspace');
    return this.upsert(user, null, rules);
  }

  private async upsert(user: AuthPrincipal, boardId: string | null, rules: HealthRule[]): Promise<HealthRuleSetDto> {
    const [existing] = await this.runner.tx
      .select()
      .from(healthRuleSets)
      .where(
        and(
          boardId === null ? isNull(healthRuleSets.boardId) : eq(healthRuleSets.boardId, boardId),
          isNull(healthRuleSets.deletedAt),
        ),
      );
    const row =
      existing === undefined
        ? (
            await this.runner.tx
              .insert(healthRuleSets)
              .values({ tenantId: user.tenantId, boardId, rules, createdBy: user.userId })
              .returning()
          )[0]
        : (
            await this.runner.tx
              .update(healthRuleSets)
              .set({ rules, updatedAt: new Date() })
              .where(eq(healthRuleSets.id, existing.id))
              .returning()
          )[0];
    if (row === undefined) throw new Error('Falha ao salvar regras de saúde.');
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'health_rule_set.changed',
      aggregateType: 'health_rule_set',
      aggregateId: row.id,
      ...(boardId === null ? {} : { boardId }),
      payload: { ruleSetId: row.id, boardId: row.boardId },
      actorId: user.userId,
    });
    return { id: row.id, boardId: row.boardId, rules: row.rules };
  }
}
