import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import {
  aggregateRollup,
  aggregateValues,
  Decimal,
  isGroupFilter,
  parseWidgetConfig,
  shiftDays,
  storedNumber,
  type AggregateSource,
  type BatteryWidgetConfig,
  type BoardRollupInput,
  type BudgetVarianceWidgetConfig,
  type CapacityBucket,
  type CapacityWidgetConfig,
  type ChartBarWidgetConfig,
  type ChartPieWidgetConfig,
  type FilterGroup,
  type NumberWidgetConfig,
  type PortfolioRollupWidgetConfig,
  type RiskHeatmapWidgetConfig,
  type RollupResult,
  type WidgetFilter,
  type WorkloadWidgetConfig,
} from '@cube-track/shared';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { AccessService } from '../../access/application/access.service.js';
import { CapacityService } from '../../resources/application/capacity.service.js';
import type { ColumnDefinition } from '../../work/domain/board-definition.js';
import { todayIn } from '../../work/domain/board-definition.js';
import type { ItemDto } from '../../work/domain/item.js';
import { BoardDefinitionRepository } from '../../work/infrastructure/board-definition.repository.js';
import { ItemsService } from '../../work/application/items.service.js';
import type { WidgetDto } from './widgets.service.js';

const { memberships, projectHealth, users, portfolios, programs, boards, budgets, costEntries, risks } = schema;

/** Risco "crítico" (ADR 0053): score probabilidade × impacto (1–25) >= 15 — convenção comum de PPM. */
const CRITICAL_RISK_SCORE = 15;

export type WidgetData =
  | { kind: 'number'; value: string | null }
  | { kind: 'chart'; categories: { key: string; label: string; value: number; color: string | null }[] }
  | { kind: 'battery'; onTime: number; replanned: number; late: number; noDate: number; total: number }
  | { kind: 'workload'; people: { personId: string; personName: string; value: number }[] }
  | {
      kind: 'capacity';
      granularity: 'day' | 'week' | 'month';
      rows: { userId: string; userName: string; buckets: CapacityBucket[] }[];
    }
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
    }
  | { kind: 'portfolio_rollup'; scope: 'portfolio' | 'program'; name: string | null; rollup: RollupResult }
  | {
      kind: 'risk_heatmap';
      risks: { id: string; title: string; boardId: string; probability: number; impact: number; status: string }[];
    }
  | {
      kind: 'budget_variance';
      budgets: {
        budgetId: string;
        boardId: string | null;
        boardName: string | null;
        name: string;
        category: 'capex' | 'opex';
        plannedAmount: string;
        actualAmount: string;
        forecastAmount: string;
      }[];
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
    private readonly capacity: CapacityService,
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
      case 'capacity':
        return this.computeCapacity(user, parseWidgetConfig('capacity', widget.config));
      case 'portfolio_rollup':
        return this.computePortfolioRollup(user, parseWidgetConfig('portfolio_rollup', widget.config));
      case 'risk_heatmap':
        return this.computeRiskHeatmap(user, parseWidgetConfig('risk_heatmap', widget.config));
      case 'budget_variance':
        return this.computeBudgetVariance(user, parseWidgetConfig('budget_variance', widget.config));
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

  /**
   * Capacidade (ADR 0052): janela fixa de 4 semanas a partir de hoje (dashboards são "visão
   * atual", diferente da view Workload/Capacity, que deixa a pessoa escolher o período).
   */
  private async computeCapacity(user: AuthPrincipal, config: CapacityWidgetConfig): Promise<WidgetData> {
    const today = todayIn(await this.definitions.tenantTimezone(this.runner.tx, user.tenantId));
    const result = await this.capacity.heatmap(user, {
      from: today,
      to: shiftDays(today, 27),
      granularity: config.granularity,
      userIds: config.userIds,
      teamIds: config.teamIds,
      skillId: config.skillId,
    });
    return {
      kind: 'capacity',
      granularity: result.granularity,
      rows: result.rows.map((row) => ({ userId: row.userId, userName: row.userName, buckets: row.buckets })),
    };
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

  /** Boards de um portfólio: diretos (`portfolioId`) + os de todo programa do portfólio. */
  private async boardsOfPortfolio(portfolioId: string): Promise<{ id: string }[]> {
    const programRows = await this.runner.tx
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.portfolioId, portfolioId), isNull(programs.deletedAt)));
    const programIds = programRows.map((row) => row.id);
    const rows = await this.runner.tx
      .select({ id: boards.id })
      .from(boards)
      .where(
        and(
          isNull(boards.deletedAt),
          programIds.length > 0
            ? or(eq(boards.portfolioId, portfolioId), inArray(boards.programId, programIds))
            : eq(boards.portfolioId, portfolioId),
        ),
      );
    return rows;
  }

  /**
   * Rollup de portfólio/programa (ADR 0053): agrega os boards (diretos ou via programas) com o motor
   * `aggregateRollup` de `packages/shared`. UST ainda não entra no rollup (depende do módulo de
   * Contratos/OS, Prompt 13) — sempre `0` nesta entrega.
   */
  private async computePortfolioRollup(
    user: AuthPrincipal,
    config: PortfolioRollupWidgetConfig,
  ): Promise<WidgetData> {
    const owner =
      config.scope === 'portfolio'
        ? await this.runner.tx
            .select({ workspaceId: portfolios.workspaceId, name: portfolios.name })
            .from(portfolios)
            .where(eq(portfolios.id, config.id))
            .then((rows) => rows[0])
        : await this.runner.tx
            .select({ workspaceId: programs.workspaceId, name: programs.name })
            .from(programs)
            .where(eq(programs.id, config.id))
            .then((rows) => rows[0]);
    if (owner === undefined) return { kind: 'portfolio_rollup', scope: config.scope, name: null, rollup: aggregateRollup([]) };
    if (!(await this.access.can(user, 'portfolio.read', { type: 'workspace', id: owner.workspaceId })))
      return { kind: 'portfolio_rollup', scope: config.scope, name: owner.name, rollup: aggregateRollup([]) };

    const boardRows =
      config.scope === 'portfolio'
        ? await this.boardsOfPortfolio(config.id)
        : await this.runner.tx
            .select({ id: boards.id })
            .from(boards)
            .where(and(eq(boards.programId, config.id), isNull(boards.deletedAt)))
            .then((rows) => rows.map((row) => ({ id: row.id })));
    const boardIds = boardRows.map((row) => row.id);
    if (boardIds.length === 0) return { kind: 'portfolio_rollup', scope: config.scope, name: owner.name, rollup: aggregateRollup([]) };

    const boardMeta = await this.runner.tx
      .select({ id: boards.id, startDate: boards.startDate, endDate: boards.endDate })
      .from(boards)
      .where(inArray(boards.id, boardIds));
    const budgetRows = await this.runner.tx
      .select({ id: budgets.id, boardId: budgets.boardId, plannedAmount: budgets.plannedAmount })
      .from(budgets)
      .where(and(inArray(budgets.boardId, boardIds), isNull(budgets.deletedAt)));
    const budgetIds = budgetRows.map((row) => row.id);
    const costRows =
      budgetIds.length === 0
        ? []
        : await this.runner.tx
            .select({ budgetId: costEntries.budgetId, kind: costEntries.kind, amount: costEntries.amount })
            .from(costEntries)
            .where(and(inArray(costEntries.budgetId, budgetIds), isNull(costEntries.deletedAt)));
    const riskRows = await this.runner.tx
      .select({ boardId: risks.boardId, probability: risks.probability, impact: risks.impact })
      .from(risks)
      .where(and(inArray(risks.boardId, boardIds), isNull(risks.deletedAt), inArray(risks.status, ['open', 'mitigating'])));
    const healthRows = await this.runner.tx
      .select({
        boardId: projectHealth.boardId,
        overall: projectHealth.overall,
        percentComplete: projectHealth.percentComplete,
        eac: projectHealth.eac,
        reportedAt: projectHealth.reportedAt,
      })
      .from(projectHealth)
      .where(inArray(projectHealth.boardId, boardIds))
      .orderBy(desc(projectHealth.reportedAt));

    const latestHealthByBoard = new Map<string, (typeof healthRows)[number]>();
    for (const row of healthRows) if (!latestHealthByBoard.has(row.boardId)) latestHealthByBoard.set(row.boardId, row);

    const inputs: BoardRollupInput[] = boardMeta.map((board) => {
      const boardBudgets = budgetRows.filter((row) => row.boardId === board.id);
      const plannedCost = boardBudgets.reduce((sum, row) => sum + Number(row.plannedAmount), 0);
      const budgetIdsOfBoard = new Set(boardBudgets.map((row) => row.id));
      const actualCost = costRows
        .filter((row) => budgetIdsOfBoard.has(row.budgetId) && row.kind === 'actual')
        .reduce((sum, row) => sum + Number(row.amount), 0);
      const health = latestHealthByBoard.get(board.id);
      const forecastCost = health?.eac !== undefined && health.eac !== null ? Number(health.eac) : actualCost;
      const boardRisks = riskRows.filter((row) => row.boardId === board.id);
      return {
        boardId: board.id,
        startDate: board.startDate,
        endDate: board.endDate,
        percentComplete:
          health?.percentComplete !== undefined && health.percentComplete !== null
            ? Number(health.percentComplete)
            : null,
        overall: health?.overall ?? 'grey',
        plannedCost,
        actualCost,
        forecastCost,
        ustTotal: 0,
        openRisks: boardRisks.length,
        criticalRisks: boardRisks.filter((row) => row.probability * row.impact >= CRITICAL_RISK_SCORE).length,
      };
    });
    return { kind: 'portfolio_rollup', scope: config.scope, name: owner.name, rollup: aggregateRollup(inputs) };
  }

  /** Matriz de riscos abertos (probabilidade × impacto) dos boards informados que o usuário pode ler. */
  private async computeRiskHeatmap(user: AuthPrincipal, config: RiskHeatmapWidgetConfig): Promise<WidgetData> {
    const readableBoardIds: string[] = [];
    for (const boardId of config.boardIds) {
      if (await this.access.can(user, 'board.read', { type: 'board', id: boardId })) readableBoardIds.push(boardId);
    }
    if (readableBoardIds.length === 0) return { kind: 'risk_heatmap', risks: [] };
    const rows = await this.runner.tx
      .select({
        id: risks.id,
        title: risks.title,
        boardId: risks.boardId,
        probability: risks.probability,
        impact: risks.impact,
        status: risks.status,
      })
      .from(risks)
      .where(and(inArray(risks.boardId, readableBoardIds), isNull(risks.deletedAt), inArray(risks.status, ['open', 'mitigating'])));
    return { kind: 'risk_heatmap', risks: rows };
  }

  /**
   * Planejado × realizado × previsto (EAC quando relatado, senão igual ao realizado) dos orçamentos
   * de projeto dos boards informados que o usuário pode ler.
   */
  private async computeBudgetVariance(user: AuthPrincipal, config: BudgetVarianceWidgetConfig): Promise<WidgetData> {
    const readableBoardIds: string[] = [];
    for (const boardId of config.boardIds) {
      if (await this.access.can(user, 'board.read', { type: 'board', id: boardId })) readableBoardIds.push(boardId);
    }
    if (readableBoardIds.length === 0) return { kind: 'budget_variance', budgets: [] };
    const boardNames = new Map(
      (
        await this.runner.tx.select({ id: boards.id, name: boards.name }).from(boards).where(inArray(boards.id, readableBoardIds))
      ).map((row) => [row.id, row.name]),
    );
    const budgetRows = await this.runner.tx
      .select()
      .from(budgets)
      .where(and(inArray(budgets.boardId, readableBoardIds), isNull(budgets.deletedAt)));
    const budgetIds = budgetRows.map((row) => row.id);
    const costRows =
      budgetIds.length === 0
        ? []
        : await this.runner.tx
            .select({ budgetId: costEntries.budgetId, kind: costEntries.kind, amount: costEntries.amount })
            .from(costEntries)
            .where(and(inArray(costEntries.budgetId, budgetIds), isNull(costEntries.deletedAt)));
    const healthRows = await this.runner.tx
      .select({ boardId: projectHealth.boardId, eac: projectHealth.eac, reportedAt: projectHealth.reportedAt })
      .from(projectHealth)
      .where(inArray(projectHealth.boardId, readableBoardIds))
      .orderBy(desc(projectHealth.reportedAt));
    const latestEacByBoard = new Map<string, string | null>();
    for (const row of healthRows) if (!latestEacByBoard.has(row.boardId)) latestEacByBoard.set(row.boardId, row.eac);

    return {
      kind: 'budget_variance',
      budgets: budgetRows.map((budget) => {
        const actualAmount = costRows
          .filter((row) => row.budgetId === budget.id && row.kind === 'actual')
          .reduce((sum, row) => sum + Number(row.amount), 0);
        const eac = budget.boardId === null ? null : (latestEacByBoard.get(budget.boardId) ?? null);
        return {
          budgetId: budget.id,
          boardId: budget.boardId,
          boardName: budget.boardId === null ? null : (boardNames.get(budget.boardId) ?? null),
          name: budget.name,
          category: budget.category,
          plannedAmount: budget.plannedAmount,
          actualAmount: actualAmount.toFixed(2),
          forecastAmount: eac ?? actualAmount.toFixed(2),
        };
      }),
    };
  }
}
