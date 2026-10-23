import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { positionBetween } from '@cube-track/shared';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { dashboards } = schema;

export interface DashboardDto {
  id: string;
  workspaceId: string;
  ownerId: string | null;
  name: string;
  description: string | null;
  visibility: 'private' | 'workspace';
  sourceBoardIds: string[];
  filters: Record<string, unknown> | null;
  refreshIntervalSeconds: number | null;
  position: string;
  createdAt: string;
  updatedAt: string;
  /** O usuário atual pode editar (dono, ou `workspace.manage` com visibilidade `workspace`). */
  canEdit: boolean;
}

export interface UpsertDashboardInput {
  name?: string | undefined;
  description?: string | null | undefined;
  visibility?: 'private' | 'workspace' | undefined;
  sourceBoardIds?: string[] | undefined;
  filters?: Record<string, unknown> | null | undefined;
  refreshIntervalSeconds?: number | null | undefined;
}

function toDto(row: typeof dashboards.$inferSelect, canEdit: boolean): DashboardDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ownerId: row.ownerId,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    sourceBoardIds: row.sourceBoardIds,
    filters: row.filters ?? null,
    refreshIntervalSeconds: row.refreshIntervalSeconds,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    canEdit,
  };
}

/**
 * Dashboards de workspace (ADR 0050): painéis com widgets alimentados por um ou mais boards.
 * Permissões já resolvidas em `packages/shared/src/permissions.ts` (`decide`, caso `'dashboard'`):
 * o dono sempre acessa; com visibilidade `workspace`, quem lê/gerencia o workspace acessa/edita.
 */
@Injectable()
export class DashboardsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async listByWorkspace(user: AuthPrincipal, workspaceId: string): Promise<DashboardDto[]> {
    await this.access.assert(user, 'workspace.read', { type: 'workspace', id: workspaceId }, 'Workspace');
    const workspaceAccess = await this.access.workspace(user, workspaceId);
    const canManageWorkspace = workspaceAccess?.permissions.includes('workspace.manage') ?? false;
    const rows = await this.runner.tx
      .select()
      .from(dashboards)
      .where(and(eq(dashboards.workspaceId, workspaceId), isNull(dashboards.deletedAt)))
      .orderBy(asc(dashboards.position));
    return rows
      .filter((row) => row.visibility === 'workspace' || row.ownerId === user.userId)
      .map((row) => toDto(row, row.ownerId === user.userId || canManageWorkspace));
  }

  async get(user: AuthPrincipal, dashboardId: string): Promise<DashboardDto> {
    const row = await this.find(dashboardId);
    await this.access.assert(user, 'dashboard.read', { type: 'dashboard', id: dashboardId }, 'Dashboard');
    const canEdit = await this.access.can(user, 'dashboard.update', { type: 'dashboard', id: dashboardId });
    return toDto(row, canEdit);
  }

  async create(
    user: AuthPrincipal,
    workspaceId: string,
    input: UpsertDashboardInput & { name: string },
  ): Promise<DashboardDto> {
    await this.access.assert(
      user,
      'dashboard.create',
      { type: 'workspace', id: workspaceId },
      'Workspace',
    );
    const tx = this.runner.tx;
    const [last] = await tx
      .select({ position: dashboards.position })
      .from(dashboards)
      .where(and(eq(dashboards.workspaceId, workspaceId), isNull(dashboards.deletedAt)))
      .orderBy(desc(dashboards.position))
      .limit(1);
    const position = positionBetween(last?.position ?? null, null);
    const [row] = await tx
      .insert(dashboards)
      .values({
        tenantId: user.tenantId,
        workspaceId,
        ownerId: user.userId,
        name: input.name,
        description: input.description ?? null,
        ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
        sourceBoardIds: input.sourceBoardIds ?? [],
        filters: input.filters ?? null,
        refreshIntervalSeconds: input.refreshIntervalSeconds ?? null,
        position,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar dashboard');
    this.events.recordChange({
      action: 'dashboard.created',
      entityType: 'dashboard',
      entityId: row.id,
      after: { name: row.name, workspaceId },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'dashboard.changed',
      aggregateType: 'dashboard',
      aggregateId: row.id,
      dashboardId: row.id,
      payload: { dashboardId: row.id, change: 'created' },
      actorId: user.userId,
    });
    return toDto(row, true);
  }

  async update(
    user: AuthPrincipal,
    dashboardId: string,
    input: UpsertDashboardInput,
  ): Promise<DashboardDto> {
    const existing = await this.find(dashboardId);
    await this.access.assert(user, 'dashboard.update', { type: 'dashboard', id: dashboardId }, 'Dashboard');
    const [row] = await this.runner.tx
      .update(dashboards)
      .set({
        name: input.name ?? existing.name,
        description: input.description === undefined ? existing.description : input.description,
        visibility: input.visibility ?? existing.visibility,
        sourceBoardIds: input.sourceBoardIds ?? existing.sourceBoardIds,
        filters: input.filters === undefined ? existing.filters : input.filters,
        refreshIntervalSeconds:
          input.refreshIntervalSeconds === undefined
            ? existing.refreshIntervalSeconds
            : input.refreshIntervalSeconds,
        updatedAt: new Date(),
      })
      .where(eq(dashboards.id, dashboardId))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar dashboard');
    this.events.recordChange({
      action: 'dashboard.updated',
      entityType: 'dashboard',
      entityId: row.id,
      before: { name: existing.name, visibility: existing.visibility },
      after: { name: row.name, visibility: row.visibility },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'dashboard.changed',
      aggregateType: 'dashboard',
      aggregateId: row.id,
      dashboardId: row.id,
      payload: { dashboardId: row.id, change: 'updated' },
      actorId: user.userId,
    });
    return toDto(row, true);
  }

  async remove(user: AuthPrincipal, dashboardId: string): Promise<void> {
    const existing = await this.find(dashboardId);
    await this.access.assert(user, 'dashboard.update', { type: 'dashboard', id: dashboardId }, 'Dashboard');
    await this.runner.tx
      .update(dashboards)
      .set({ deletedAt: new Date() })
      .where(eq(dashboards.id, dashboardId));
    this.events.recordChange({
      action: 'dashboard.deleted',
      entityType: 'dashboard',
      entityId: dashboardId,
      before: { name: existing.name },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'dashboard.changed',
      aggregateType: 'dashboard',
      aggregateId: dashboardId,
      dashboardId,
      payload: { dashboardId, change: 'deleted' },
      actorId: user.userId,
    });
  }

  async find(dashboardId: string): Promise<typeof dashboards.$inferSelect> {
    const [row] = await this.runner.tx
      .select()
      .from(dashboards)
      .where(and(eq(dashboards.id, dashboardId), isNull(dashboards.deletedAt)));
    if (row === undefined) throw new NotFoundError('Dashboard');
    return row;
  }
}
