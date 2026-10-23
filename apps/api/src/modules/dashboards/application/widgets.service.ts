import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { isWidgetType, parseWidgetConfig, type WidgetLayout, type WidgetType } from '@cube-track/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { widgets } = schema;

export interface WidgetDto {
  id: string;
  dashboardId: string;
  type: WidgetType;
  title: string;
  config: Record<string, unknown>;
  layout: WidgetLayout;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWidgetInput {
  type: string;
  title: string;
  config: Record<string, unknown>;
  layout: WidgetLayout;
}

export interface UpdateWidgetInput {
  title?: string | undefined;
  config?: Record<string, unknown> | undefined;
  layout?: WidgetLayout | undefined;
}

function toDto(row: typeof widgets.$inferSelect): WidgetDto {
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    type: row.type as WidgetType,
    title: row.title,
    config: row.config,
    layout: row.layout,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Valida `config` conforme `type` no registro de widgets (packages/shared/src/widgets.ts). */
function validatedConfig(type: string, config: Record<string, unknown>): Record<string, unknown> {
  if (!isWidgetType(type))
    throw new ValidationError([{ path: 'body.type', message: `Tipo de widget desconhecido: ${type}.` }]);
  try {
    return parseWidgetConfig(type, config);
  } catch {
    throw new ValidationError([{ path: 'body.config', message: 'Configuração inválida para o tipo de widget.' }]);
  }
}

/** Widgets de um dashboard (ADR 0050): editar widgets é editar o dashboard (`dashboard.update`). */
@Injectable()
export class WidgetsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  /** Lê um widget garantindo que o usuário pode ler o dashboard a que ele pertence. */
  async getChecked(user: AuthPrincipal, widgetId: string): Promise<WidgetDto> {
    const row = await this.find(widgetId);
    await this.access.assert(user, 'dashboard.read', { type: 'dashboard', id: row.dashboardId }, 'Dashboard');
    return toDto(row);
  }

  async listByDashboard(user: AuthPrincipal, dashboardId: string): Promise<WidgetDto[]> {
    await this.access.assert(user, 'dashboard.read', { type: 'dashboard', id: dashboardId }, 'Dashboard');
    const rows = await this.runner.tx
      .select()
      .from(widgets)
      .where(and(eq(widgets.dashboardId, dashboardId), isNull(widgets.deletedAt)))
      .orderBy(asc(widgets.createdAt));
    return rows.map(toDto);
  }

  async create(user: AuthPrincipal, dashboardId: string, input: CreateWidgetInput): Promise<WidgetDto> {
    await this.access.assert(user, 'dashboard.update', { type: 'dashboard', id: dashboardId }, 'Dashboard');
    const config = validatedConfig(input.type, input.config);
    const [row] = await this.runner.tx
      .insert(widgets)
      .values({
        tenantId: user.tenantId,
        dashboardId,
        type: input.type,
        title: input.title,
        config,
        layout: input.layout,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar widget');
    this.events.recordChange({
      action: 'widget.created',
      entityType: 'widget',
      entityId: row.id,
      after: { type: row.type, title: row.title },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'widget.changed',
      aggregateType: 'widget',
      aggregateId: row.id,
      dashboardId,
      payload: { widgetId: row.id, dashboardId, change: 'created' },
      actorId: user.userId,
    });
    return toDto(row);
  }

  async update(user: AuthPrincipal, widgetId: string, input: UpdateWidgetInput): Promise<WidgetDto> {
    const existing = await this.find(widgetId);
    await this.access.assert(
      user,
      'dashboard.update',
      { type: 'dashboard', id: existing.dashboardId },
      'Dashboard',
    );
    const config =
      input.config === undefined ? existing.config : validatedConfig(existing.type, input.config);
    const [row] = await this.runner.tx
      .update(widgets)
      .set({
        title: input.title ?? existing.title,
        config,
        layout: input.layout ?? existing.layout,
        updatedAt: new Date(),
      })
      .where(eq(widgets.id, widgetId))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar widget');
    this.events.recordChange({
      action: 'widget.updated',
      entityType: 'widget',
      entityId: row.id,
      before: { title: existing.title },
      after: { title: row.title },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'widget.changed',
      aggregateType: 'widget',
      aggregateId: row.id,
      dashboardId: row.dashboardId,
      payload: { widgetId: row.id, dashboardId: row.dashboardId, change: 'updated' },
      actorId: user.userId,
    });
    return toDto(row);
  }

  async remove(user: AuthPrincipal, widgetId: string): Promise<void> {
    const existing = await this.find(widgetId);
    await this.access.assert(
      user,
      'dashboard.update',
      { type: 'dashboard', id: existing.dashboardId },
      'Dashboard',
    );
    await this.runner.tx.update(widgets).set({ deletedAt: new Date() }).where(eq(widgets.id, widgetId));
    this.events.recordChange({
      action: 'widget.deleted',
      entityType: 'widget',
      entityId: widgetId,
      before: { title: existing.title },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'widget.changed',
      aggregateType: 'widget',
      aggregateId: widgetId,
      dashboardId: existing.dashboardId,
      payload: { widgetId, dashboardId: existing.dashboardId, change: 'deleted' },
      actorId: user.userId,
    });
  }

  async find(widgetId: string): Promise<typeof widgets.$inferSelect> {
    const [row] = await this.runner.tx
      .select()
      .from(widgets)
      .where(and(eq(widgets.id, widgetId), isNull(widgets.deletedAt)));
    if (row === undefined) throw new NotFoundError('Widget');
    return row;
  }
}
