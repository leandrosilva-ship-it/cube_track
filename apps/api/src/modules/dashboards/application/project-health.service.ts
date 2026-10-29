import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import type { HealthStatus } from '@cube-track/shared';
import { desc, eq } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { projectHealth } = schema;

export interface ProjectHealthDto {
  id: string;
  boardId: string;
  reportedBy: string | null;
  reportedAt: string;
  overall: HealthStatus;
  schedule: HealthStatus;
  cost: HealthStatus;
  scope: HealthStatus;
  quality: HealthStatus;
  risk: HealthStatus;
  percentComplete: string | null;
  spi: string | null;
  cpi: string | null;
  summary: string | null;
  isAutomatic: boolean;
  overrideReason: string | null;
  plannedValue: string | null;
  earnedValue: string | null;
  actualCost: string | null;
  eac: string | null;
  vac: string | null;
}

export interface ReportProjectHealthInput {
  overall: HealthStatus;
  schedule?: HealthStatus | undefined;
  cost?: HealthStatus | undefined;
  scope?: HealthStatus | undefined;
  quality?: HealthStatus | undefined;
  risk?: HealthStatus | undefined;
  percentComplete?: number | undefined;
  spi?: number | undefined;
  cpi?: number | undefined;
  summary?: string | undefined;
  overrideReason?: string | undefined;
}

function toDto(row: typeof projectHealth.$inferSelect): ProjectHealthDto {
  return {
    id: row.id,
    boardId: row.boardId,
    reportedBy: row.reportedBy,
    reportedAt: row.reportedAt.toISOString(),
    overall: row.overall,
    schedule: row.schedule,
    cost: row.cost,
    scope: row.scope,
    quality: row.quality,
    risk: row.risk,
    percentComplete: row.percentComplete,
    spi: row.spi,
    cpi: row.cpi,
    summary: row.summary,
    isAutomatic: row.isAutomatic,
    overrideReason: row.overrideReason,
    plannedValue: row.plannedValue,
    earnedValue: row.earnedValue,
    actualCost: row.actualCost,
    eac: row.eac,
    vac: row.vac,
  };
}

/**
 * Relato de saúde do projeto (ADR 0050): série histórica append-only, sempre manual — quem relata
 * (board.manage) decide as cores; não há cálculo automático de EVM nesta entrega.
 */
@Injectable()
export class ProjectHealthService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async history(user: AuthPrincipal, boardId: string, limit = 50): Promise<ProjectHealthDto[]> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx
      .select()
      .from(projectHealth)
      .where(eq(projectHealth.boardId, boardId))
      .orderBy(desc(projectHealth.reportedAt))
      .limit(limit);
    return rows.map(toDto);
  }

  /**
   * Relato manual: sobrepor um relato automático (RAG por regras, ADR 0053) exige `overrideReason`
   * — mesmo padrão de campo condicionalmente obrigatório de `column.requiredWhen`
   * (`packages/shared/src/columns/registry.ts`), aqui decidido pelo estado do servidor (o último
   * relato do board) em vez de por outro campo do próprio corpo da requisição.
   */
  async report(
    user: AuthPrincipal,
    boardId: string,
    input: ReportProjectHealthInput,
  ): Promise<ProjectHealthDto> {
    await this.access.assert(user, 'board.manage', { type: 'board', id: boardId }, 'Board');
    const [latest] = await this.runner.tx
      .select({ isAutomatic: projectHealth.isAutomatic })
      .from(projectHealth)
      .where(eq(projectHealth.boardId, boardId))
      .orderBy(desc(projectHealth.reportedAt))
      .limit(1);
    if (latest?.isAutomatic === true && (input.overrideReason ?? '') === '') {
      throw new ValidationError([
        {
          path: 'body.overrideReason',
          message: 'Justificativa obrigatória para sobrepor um relato automático.',
        },
      ]);
    }
    const [row] = await this.runner.tx
      .insert(projectHealth)
      .values({
        tenantId: user.tenantId,
        boardId,
        reportedBy: user.userId,
        overall: input.overall,
        schedule: input.schedule ?? 'grey',
        cost: input.cost ?? 'grey',
        scope: input.scope ?? 'grey',
        quality: input.quality ?? 'grey',
        risk: input.risk ?? 'grey',
        percentComplete: input.percentComplete === undefined ? null : String(input.percentComplete),
        spi: input.spi === undefined ? null : String(input.spi),
        cpi: input.cpi === undefined ? null : String(input.cpi),
        summary: input.summary ?? null,
        isAutomatic: false,
        overrideReason: input.overrideReason ?? null,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao registrar saúde do projeto');
    this.events.recordChange({
      action: 'project_health.reported',
      entityType: 'project_health',
      entityId: row.id,
      boardId,
      after: { overall: row.overall, isAutomatic: false },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'project_health.reported',
      aggregateType: 'project_health',
      aggregateId: row.id,
      boardId,
      payload: { healthId: row.id, boardId },
      actorId: user.userId,
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'project_health.changed',
      aggregateType: 'project_health',
      aggregateId: row.id,
      boardId,
      payload: { healthId: row.id, boardId, overall: row.overall, isAutomatic: false },
      actorId: user.userId,
    });
    return toDto(row);
  }
}
