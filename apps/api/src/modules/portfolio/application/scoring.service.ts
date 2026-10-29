import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { classifyEffortValue, computeWeightedScore, computeWsjf, median, wsjfInputFromScores } from '@cube-track/shared';
import { and, eq, isNull } from 'drizzle-orm';

type ScoringCriterion = (typeof schema.scoringModels.$inferSelect)['criteria'][number];

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { primaryWorkspaceId } from '../../resources/application/workspace-scope.js';

const { scoringModels, scores, boards } = schema;

type ScoringModelRow = typeof scoringModels.$inferSelect;
type ScoreRow = typeof scores.$inferSelect;

export interface ScoringModelDto {
  id: string;
  name: string;
  description: string | null;
  method: ScoringModelRow['method'];
  criteria: ScoringCriterion[];
  isDefault: boolean;
}

export interface ScoringModelInput {
  name: string;
  description?: string | null | undefined;
  method?: ScoringModelRow['method'] | undefined;
  criteria: ScoringCriterion[];
  isDefault?: boolean | undefined;
}

export interface UpdateScoringModelInput {
  name?: string | undefined;
  description?: string | null | undefined;
  method?: ScoringModelRow['method'] | undefined;
  criteria?: ScoringCriterion[] | undefined;
  isDefault?: boolean | undefined;
}

export interface ScoreDto {
  id: string;
  scoringModelId: string;
  boardId: string;
  criteriaScores: Record<string, number>;
  totalScore: string;
  scoredBy: string | null;
  scoredAt: string;
  rationale: string | null;
}

function toModelDto(row: ScoringModelRow): ScoringModelDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    method: row.method,
    criteria: row.criteria,
    isDefault: row.isDefault,
  };
}

function toScoreDto(row: ScoreRow): ScoreDto {
  return {
    id: row.id,
    scoringModelId: row.scoringModelId,
    boardId: row.boardId,
    criteriaScores: row.criteriaScores,
    totalScore: row.totalScore,
    scoredBy: row.scoredBy,
    scoredAt: row.scoredAt.toISOString(),
    rationale: row.rationale,
  };
}

/**
 * Priorização (ADR 0053): modelos de pontuação (ponderada ou WSJF), pontuação por projeto, matriz
 * valor × esforço e ranking. `scoringModels`/`scores` não têm `workspaceId` próprio — mesma decisão
 * de `resources.manage` (ADR 0052): assume-se o workspace principal do tenant.
 */
@Injectable()
export class ScoringService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async listModels(user: AuthPrincipal): Promise<ScoringModelDto[]> {
    await this.assertManage(user, 'portfolio.read');
    const rows = await this.runner.tx.select().from(scoringModels).where(isNull(scoringModels.deletedAt));
    return rows.map(toModelDto);
  }

  async createModel(user: AuthPrincipal, input: ScoringModelInput): Promise<ScoringModelDto> {
    await this.assertManage(user, 'portfolio.manage');
    const [row] = await this.runner.tx
      .insert(scoringModels)
      .values({
        tenantId: user.tenantId,
        name: input.name,
        description: input.description ?? null,
        method: input.method ?? 'weighted',
        criteria: input.criteria,
        isDefault: input.isDefault ?? false,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar modelo de pontuação.');
    return toModelDto(row);
  }

  async updateModel(user: AuthPrincipal, id: string, input: UpdateScoringModelInput): Promise<ScoringModelDto> {
    await this.assertManage(user, 'portfolio.manage');
    const [existing] = await this.runner.tx.select().from(scoringModels).where(eq(scoringModels.id, id));
    if (existing === undefined) throw new NotFoundError('Modelo de pontuação');
    const [row] = await this.runner.tx
      .update(scoringModels)
      .set({
        name: input.name ?? existing.name,
        description: input.description === undefined ? existing.description : input.description,
        method: input.method ?? existing.method,
        criteria: input.criteria ?? existing.criteria,
        isDefault: input.isDefault ?? existing.isDefault,
        updatedAt: new Date(),
      })
      .where(eq(scoringModels.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar modelo de pontuação.');
    return toModelDto(row);
  }

  async setScore(
    user: AuthPrincipal,
    boardId: string,
    input: { scoringModelId: string; criteriaScores: Record<string, number>; rationale?: string | null | undefined },
  ): Promise<ScoreDto> {
    await this.access.assert(user, 'board.manage', { type: 'board', id: boardId }, 'Board');
    const [model] = await this.runner.tx
      .select()
      .from(scoringModels)
      .where(eq(scoringModels.id, input.scoringModelId));
    if (model === undefined) throw new NotFoundError('Modelo de pontuação');

    let totalScore: number;
    if (model.method === 'wsjf') {
      const wsjfInput = wsjfInputFromScores(input.criteriaScores);
      if (wsjfInput === undefined)
        throw new ValidationError([
          { path: 'body.criteriaScores', message: 'WSJF exige business_value, time_criticality, risk_reduction e job_size.' },
        ]);
      totalScore = computeWsjf(wsjfInput);
    } else {
      totalScore = computeWeightedScore(model.criteria, input.criteriaScores);
    }

    const [row] = await this.runner.tx
      .insert(scores)
      .values({
        tenantId: user.tenantId,
        scoringModelId: input.scoringModelId,
        boardId,
        criteriaScores: input.criteriaScores,
        totalScore: totalScore.toFixed(4),
        scoredBy: user.userId,
        rationale: input.rationale ?? null,
      })
      .onConflictDoUpdate({
        target: [scores.scoringModelId, scores.boardId],
        set: {
          criteriaScores: input.criteriaScores,
          totalScore: totalScore.toFixed(4),
          scoredBy: user.userId,
          scoredAt: new Date(),
          rationale: input.rationale ?? null,
        },
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao gravar pontuação.');
    this.events.recordChange({
      action: 'score.set',
      entityType: 'score',
      entityId: row.id,
      boardId,
      after: { totalScore: row.totalScore },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'score.changed',
      aggregateType: 'score',
      aggregateId: row.id,
      boardId,
      payload: { scoreId: row.id, scoringModelId: row.scoringModelId, boardId },
      actorId: user.userId,
    });
    return toScoreDto(row);
  }

  async ranking(user: AuthPrincipal, scoringModelId: string): Promise<{ boardId: string; boardName: string; score: number }[]> {
    await this.assertManage(user, 'portfolio.read');
    const rows = await this.runner.tx
      .select({ boardId: scores.boardId, totalScore: scores.totalScore, boardName: boards.name })
      .from(scores)
      .innerJoin(boards, eq(boards.id, scores.boardId))
      .where(and(eq(scores.scoringModelId, scoringModelId), isNull(boards.deletedAt)));
    return rows
      .map((row) => ({ boardId: row.boardId, boardName: row.boardName, score: Number(row.totalScore) }))
      .sort((a, b) => b.score - a.score);
  }

  /** Matriz valor × esforço: usa os 2 primeiros critérios do modelo como "valor" e "esforço". */
  async valueEffortMatrix(
    user: AuthPrincipal,
    scoringModelId: string,
  ): Promise<{ boardId: string; boardName: string; value: number; effort: number; quadrant: string }[]> {
    await this.assertManage(user, 'portfolio.read');
    const [model] = await this.runner.tx.select().from(scoringModels).where(eq(scoringModels.id, scoringModelId));
    if (model === undefined) throw new NotFoundError('Modelo de pontuação');
    const valueKey = model.criteria[0]?.key;
    const effortKey = model.criteria[1]?.key;
    if (valueKey === undefined || effortKey === undefined) return [];
    const rows = await this.runner.tx
      .select({ boardId: scores.boardId, criteriaScores: scores.criteriaScores, boardName: boards.name })
      .from(scores)
      .innerJoin(boards, eq(boards.id, scores.boardId))
      .where(and(eq(scores.scoringModelId, scoringModelId), isNull(boards.deletedAt)));
    const points = rows
      .map((row) => ({
        boardId: row.boardId,
        boardName: row.boardName,
        value: row.criteriaScores[valueKey] ?? 0,
        effort: row.criteriaScores[effortKey] ?? 0,
      }))
      .filter((point) => point.value !== 0 || point.effort !== 0);
    const medianValue = median(points.map((point) => point.value));
    const medianEffort = median(points.map((point) => point.effort));
    return points.map((point) => ({
      ...point,
      quadrant: classifyEffortValue(point, medianValue, medianEffort),
    }));
  }

  private async assertManage(user: AuthPrincipal, permission: 'portfolio.manage' | 'portfolio.read'): Promise<void> {
    const workspaceId = await primaryWorkspaceId(this.runner.tx, user.tenantId);
    await this.access.assert(user, permission, { type: 'workspace', id: workspaceId }, 'Workspace');
  }
}

export type { ScoringModelRow, ScoreRow };
