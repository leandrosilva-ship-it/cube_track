import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import type { HealthStatus } from '@cube-track/shared';
import { desc, eq } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
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

  async report(
    user: AuthPrincipal,
    boardId: string,
    input: ReportProjectHealthInput,
  ): Promise<ProjectHealthDto> {
    await this.access.assert(user, 'board.manage', { type: 'board', id: boardId }, 'Board');
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
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao registrar saúde do projeto');
    this.events.recordChange({
      action: 'project_health.reported',
      entityType: 'project_health',
      entityId: row.id,
      boardId,
      after: { overall: row.overall },
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
    return toDto(row);
  }
}
