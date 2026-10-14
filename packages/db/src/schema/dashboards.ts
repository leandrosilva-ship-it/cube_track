import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';

import { dashboardVisibility } from './_enums.js';
import { deletedAt, position, tenantFk, tenantTable } from './_helpers.js';
import { users } from './identity.js';
import { workspaces } from './structure.js';

/** Dashboard com widgets alimentados por um ou mais boards. */
export const dashboards = tenantTable(
  'dashboards',
  {
    workspaceId: uuid('workspace_id').notNull(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    visibility: dashboardVisibility('visibility').notNull().default('workspace'),
    sourceBoardIds: uuid('source_board_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    filters: jsonb('filters').$type<Record<string, unknown>>(),
    refreshIntervalSeconds: integer('refresh_interval_seconds'),
    position: position('position').notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('dashboards', t.tenantId, t.workspaceId, workspaces),
    index('dashboards_workspace_position_idx')
      .on(t.workspaceId, t.position)
      .where(sql`${t.deletedAt} is null`),
    check(
      'dashboards_refresh',
      sql`${t.refreshIntervalSeconds} is null or ${t.refreshIntervalSeconds} >= 30`,
    ),
  ],
);

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Widget de dashboard (número, gráfico, tabela, bateria, Gantt, carga de trabalho...). */
export const widgets = tenantTable(
  'widgets',
  {
    dashboardId: uuid('dashboard_id').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    layout: jsonb('layout').$type<WidgetLayout>().notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('widgets', t.tenantId, t.dashboardId, dashboards),
    index('widgets_dashboard_idx')
      .on(t.dashboardId)
      .where(sql`${t.deletedAt} is null`),
  ],
);
