import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import {
  aggregateValues,
  Decimal,
  isGroupFilter,
  parseWidgetConfig,
  storedNumber,
  type AggregateSource,
  type BatteryWidgetConfig,
  type ChartBarWidgetConfig,
  type ChartPieWidgetConfig,
  type FilterGroup,
  type NumberWidgetConfig,
  type WidgetFilter,
  type WorkloadWidgetConfig,
} from '@cube-track/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { AccessService } from '../../access/application/access.service.js';
import type { ColumnDefinition } from '../../work/domain/board-definition.js';
import { todayIn } from '../../work/domain/board-definition.js';
import type { ItemDto } from '../../work/domain/item.js';
import { BoardDefinitionRepository } from '../../work/infrastructure/board-definition.repository.js';
import { ItemsService } from '../../work/application/items.service.js';
import type { WidgetDto } from './widgets.service.js';

const { memberships, projectHealth, users } = schema;

export type WidgetData =
  | { kind: 'number'; value: string | null }
  | { kind: 'chart'; categories: { key: string; label: string; value: number; color: string | null }[] }
  | { kind: 'battery'; onTime: number; replanned: number; late: number; noDate: number; total: number }
  | { kind: 'workload'; people: { personId: string; personName: string; value: number }[] }
  | {
      kind: 'project_health';
      latest: {
        id: string;
        reportedAt: string;
        overall: 'green' | 'yellow' | 'red' | 'grey';
        schedule: 'green' | 'yellow' | 'red' | 'grey';
        cost: 'green' | 'yellow' | 'red' | 'grey';
        scope: 'green' | 'yellow' | 'red' | 'grey';
        quality: 'green' | 'yellow' | 'red' | 'grey';
        risk: 'green' | 'yellow' | 'red' | 'grey';
        percentComplete: string | null;
        spi: string | null;
        cpi: string | null;
        summary: string | null;
      } | null;
      history: { id: string; reportedAt: string; overall: 'green' | 'yellow' | 'red' | 'grey' }[];
    };

/** Valor da célula no item (colunas vinculadas leem o campo nativo — mesma regra do CSV/Excel). */
function cellValue(column: ColumnDefinition, item: ItemDto): unknown {
  if (column.binding?.startsWith('item.') === true) {
    const field = column.binding.slice(5).replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
    const value = (item as unknown as Record<string, unknown>)[field];
    if (typeof value !== 'string') return null;
    return column.binding === 'item.progress' ? { n: value } : { d: value };
  }
  return item.values[column.key];
}

/** Lê o valor de uma coluna como fonte de agregação (número, data, texto, status ou checkbox). */
function sourceOf(column: ColumnDefinition | undefined, item: ItemDto): AggregateSource | null {
  if (column === undefined) return null;
  const value = cellValue(column, item);
  if (value === null || value === undefined) return null;
  if (column.type === 'status') {
    const labelId = (value as { labelId?: unknown }).labelId;
    const label = column.labels.find((entry) => entry.id === labelId);
    return label === undefined ? null : { kind: 'status', label: label.label, done: label.category === 'done' };
  }
  if (column.type === 'checkbox') return { kind: 'done', value: value === true };
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.n === 'string') return { kind: 'number', value: record.n };
    if (typeof record.d === 'string') return { kind: 'date', value: record.d };
    if (typeof record.text === 'string') return { kind: 'text', value: record.text };
  }
  if (typeof value === 'string') return { kind: 'text', value };
  return null;
}

/** Chave + rótulo + cor de um valor de coluna, para agrupar barras/pizza (status e dropdown resolvem cor). */
function bucketOf(
  column: ColumnDefinition | undefined,
  item: ItemDto,
): { key: string; label: string; color: string | null } | null {
  if (column === undefined) return null;
  const value = cellValue(column, item);
  if (value === null || value === undefined) return null;
  if (column.type === 'status') {
    const labelId = (value as { labelId?: unknown }).labelId;
    const label = column.labels.find((entry) => entry.id === labelId);
    return label === undefined ? null : { key: label.id, label: label.label, color: label.color };
  }
  if (column.type === 'dropdown') {
    const optionIds = (value as { optionIds?: unknown }).optionIds;
    const first: unknown = Array.isArray(optionIds) ? (optionIds as unknown[])[0] : undefined;
    const option = column.options.find((entry) => entry.id === first);
    return option === undefined ? null : { key: option.id, label: option.label, color: option.color };
  }
  const source = sourceOf(column, item);
  if (source === null) return null;
  const text = source.kind === 'status' ? source.label : source.kind === 'text' ? source.value : null;
  return text === null || text === '' ? null : { key: text, label: text, color: null };
}

function widgetFilterToFilterGroup(filter: WidgetFilter | undefined): FilterGroup | null {
  if (filter === undefined) return null;
  if (isGroupFilter(filter)) return { op: 'and', conditions: [{ field: 'group_id', operator: 'any_of', value: filter.groupIds }] };
  return { op: 'and', conditions: [{ field: filter.columnKey, operator: filter.operator, value: filter.value }] };
}

function numericDisplay(sources: readonly (AggregateSource | null)[], aggregate: NumberWidgetConfig['aggregate']): string | null {
  const result = aggregateValues(aggregate, sources, new Date().toISOString());
  if (result === null) return null;
  return result.n ?? result.d ?? result.text ?? null;
}

/**
 * Agregação de dados de widgets (ADR 0050): lê itens via `ItemsService.list` (mesmo motor de
 * permissão/filtro/colunas ocultas da Tabela, `ItemQueryBuilder`), em páginas de 1000, e agrega com
 * `aggregateValues`/`storedNumber` (o mesmo motor de rollup de colunas). O cliente nunca recalcula —
 * só renderiza o que este serviço devolve, mesmo padrão de "um endpoint" do Gantt (ADR 0049).
 */
@Injectable()
export class WidgetDataService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly items: ItemsService,
    private readonly definitions: BoardDefinitionRepository,
  ) {}

  async compute(user: AuthPrincipal, widget: WidgetDto): Promise<WidgetData> {
    switch (widget.type) {
      case 'number':
        return this.computeNumber(user, parseWidgetConfig('number', widget.config));
      case 'chart_bar':
        return this.computeChartBar(user, parseWidgetConfig('chart_bar', widget.config));
      case 'chart_pie':
        return this.computeChartPie(user, parseWidgetConfig('chart_pie', widget.config));
      case 'battery':
        return this.computeBattery(user, parseWidgetConfig('battery', widget.config));
      case 'workload':
        return this.computeWorkload(user, parseWidgetConfig('workload', widget.config));
      case 'project_health':
        return this.computeProjectHealth(user, parseWidgetConfig('project_health', widget.config).boardId);
    }
  }

  /** Lê todos os itens visíveis de um board (páginas de 1000), aplicando o filtro do widget. */
  private async itemsOf(
    user: AuthPrincipal,
    boardId: string,
    filter: FilterGroup | null,
  ): Promise<ItemDto[]> {
    if (!(await this.access.can(user, 'board.read', { type: 'board', id: boardId }))) return [];
    const rows: ItemDto[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.items.list(user, boardId, {
        filter,
        sort: [],
        limit: 1_000,
        cursor,
        groupId: undefined,
        parentItemId: null,
        includeArchived: false,
      });
      rows.push(...page.data);
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return rows;
  }

  private async columnsOf(boardId: string): Promise<Map<string, ColumnDefinition>> {
    const definition = await this.definitions.load(this.runner.tx, boardId);
    return new Map((definition?.columns ?? []).map((column) => [column.key, column]));
  }

  private async computeNumber(user: AuthPrincipal, config: NumberWidgetConfig): Promise<WidgetData> {
    const filter = widgetFilterToFilterGroup(config.filter);
    let sources: (AggregateSource | null)[] = [];
    let count = 0;
    for (const boardId of config.boardIds) {
      const columns = await this.columnsOf(boardId);
      const column = config.columnKey === undefined ? undefined : columns.get(config.columnKey);
      const rows = await this.itemsOf(user, boardId, filter);
      count += rows.length;
      sources = sources.concat(rows.map((row) => sourceOf(column, row)));
    }
    if (config.columnKey === undefined || config.aggregate === 'count')
      return { kind: 'number', value: String(count) };
    return { kind: 'number', value: numericDisplay(sources, config.aggregate) };
  }

  private async computeChartBar(user: AuthPrincipal, config: ChartBarWidgetConfig): Promise<WidgetData> {
    const filter = widgetFilterToFilterGroup(config.filter);
    const buckets = new Map<string, { label: string; color: string | null; sources: (AggregateSource | null)[] }>();
    for (const boardId of config.boardIds) {
      const columns = await this.columnsOf(boardId);
      const xColumn = columns.get(config.xColumnKey);
      const yColumn = config.yColumnKey === undefined ? undefined : columns.get(config.yColumnKey);
      const rows = await this.itemsOf(user, boardId, filter);
      for (const row of rows) {
        const bucket = bucketOf(xColumn, row);
        if (bucket === null) continue;
        const entry = buckets.get(bucket.key) ?? { label: bucket.label, color: bucket.color, sources: [] };
        entry.sources.push(config.yColumnKey === undefined ? { kind: 'number', value: '1' } : sourceOf(yColumn, row));
        buckets.set(bucket.key, entry);
      }
    }
    const categories = [...buckets.entries()].map(([key, entry]) => ({
      key,
      label: entry.label,
      value: Number(
        config.yColumnKey === undefined
          ? entry.sources.length
          : (numericDisplay(entry.sources, config.aggregate) ?? '0'),
      ),
      color: entry.color,
    }));
    return { kind: 'chart', categories };
  }

  private async computeChartPie(user: AuthPrincipal, config: ChartPieWidgetConfig): Promise<WidgetData> {
    const filter = widgetFilterToFilterGroup(config.filter);
    const counts = new Map<string, { label: string; color: string | null; count: number }>();
    for (const boardId of config.boardIds) {
      const columns = await this.columnsOf(boardId);
      const column = columns.get(config.columnKey);
      const rows = await this.itemsOf(user, boardId, filter);
      for (const row of rows) {
        const bucket = bucketOf(column, row);
        if (bucket === null) continue;
        const entry = counts.get(bucket.key) ?? { label: bucket.label, color: bucket.color, count: 0 };
        entry.count += 1;
        counts.set(bucket.key, entry);
      }
    }
    const categories = [...counts.entries()].map(([key, entry]) => ({
      key,
      label: entry.label,
      value: entry.count,
      color: entry.color,
    }));
    return { kind: 'chart', categories };
  }

  private async computeBattery(user: AuthPrincipal, config: BatteryWidgetConfig): Promise<WidgetData> {
    const filter = widgetFilterToFilterGroup(config.filter);
    let onTime = 0;
    let replanned = 0;
    let late = 0;
    let noDate = 0;
    for (const boardId of config.boardIds) {
      const columns = await this.columnsOf(boardId);
      const plannedColumn = columns.get(config.plannedColumnKey);
      const replannedColumn =
        config.replannedColumnKey === undefined ? undefined : columns.get(config.replannedColumnKey);
      const actualColumn = config.actualColumnKey === undefined ? undefined : columns.get(config.actualColumnKey);
      const today = todayIn(await this.definitions.tenantTimezone(this.runner.tx, user.tenantId));
      const rows = await this.itemsOf(user, boardId, filter);
      for (const row of rows) {
        const planned = sourceOf(plannedColumn, row);
        const plannedDate = planned?.kind === 'date' ? planned.value : null;
        const actual = sourceOf(actualColumn, row);
        const actualDate = actual?.kind === 'date' ? actual.value : null;
        const replannedValue = sourceOf(replannedColumn, row);
        const replannedDate = replannedValue?.kind === 'date' ? replannedValue.value : null;
        if (plannedDate === null) {
          noDate += 1;
        } else if (actualDate !== null) {
          if (actualDate > plannedDate) late += 1;
          else onTime += 1;
        } else if (replannedDate !== null && replannedDate !== plannedDate) {
          replanned += 1;
        } else if (plannedDate < today) {
          late += 1;
        } else {
          onTime += 1;
        }
      }
    }
    return { kind: 'battery', onTime, replanned, late, noDate, total: onTime + replanned + late + noDate };
  }

  private async computeWorkload(user: AuthPrincipal, config: WorkloadWidgetConfig): Promise<WidgetData> {
    const filter = widgetFilterToFilterGroup(config.filter);
    const perPerson = new Map<string, Decimal>();
    for (const boardId of config.boardIds) {
      const columns = await this.columnsOf(boardId);
      const peopleColumn = columns.get(config.peopleColumnKey);
      const valueColumn = config.valueColumnKey === undefined ? undefined : columns.get(config.valueColumnKey);
      const rows = await this.itemsOf(user, boardId, filter);
      for (const row of rows) {
        if (peopleColumn === undefined) continue;
        const value = cellValue(peopleColumn, row) as { personIds?: unknown } | null;
        const personIds = Array.isArray(value?.personIds) ? (value.personIds as string[]) : [];
        const amount =
          valueColumn === undefined ? new Decimal(1) : (storedNumber(cellValue(valueColumn, row)) ?? new Decimal(0));
        for (const personId of personIds) {
          perPerson.set(personId, (perPerson.get(personId) ?? new Decimal(0)).plus(amount));
        }
      }
    }
    const ids = [...perPerson.keys()];
    const names =
      ids.length === 0
        ? new Map<string, string>()
        : new Map(
            (
              await this.runner.tx
                .select({ id: users.id, name: users.name })
                .from(users)
                .innerJoin(memberships, eq(memberships.userId, users.id))
                .where(and(inArray(users.id, ids), isNull(memberships.deletedAt)))
            ).map((row) => [row.id, row.name]),
          );
    const people = ids
      .map((personId) => ({
        personId,
        personName: names.get(personId) ?? personId,
        value: Number(perPerson.get(personId)?.toDecimalPlaces(2).toString() ?? '0'),
      }))
      .sort((a, b) => b.value - a.value);
    return { kind: 'workload', people };
  }

  private async computeProjectHealth(user: AuthPrincipal, boardId: string): Promise<WidgetData> {
    if (!(await this.access.can(user, 'board.read', { type: 'board', id: boardId })))
      return { kind: 'project_health', latest: null, history: [] };
    const rows = await this.runner.tx
      .select()
      .from(projectHealth)
      .where(eq(projectHealth.boardId, boardId))
      .orderBy(desc(projectHealth.reportedAt))
      .limit(10);
    const latest = rows[0];
    return {
      kind: 'project_health',
      latest:
        latest === undefined
          ? null
          : {
              id: latest.id,
              reportedAt: latest.reportedAt.toISOString(),
              overall: latest.overall,
              schedule: latest.schedule,
              cost: latest.cost,
              scope: latest.scope,
              quality: latest.quality,
              risk: latest.risk,
              percentComplete: latest.percentComplete,
              spi: latest.spi,
              cpi: latest.cpi,
              summary: latest.summary,
            },
      history: rows.map((row) => ({
        id: row.id,
        reportedAt: row.reportedAt.toISOString(),
        overall: row.overall,
      })),
    };
  }
}
