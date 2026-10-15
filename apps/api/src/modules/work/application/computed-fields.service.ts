import { Injectable } from '@nestjs/common';
import { loadWorkingCalendar, schema } from '@cube-track/db';
import {
  computeItemColumns,
  DEFAULT_CALENDAR,
  shiftDays,
  type ComputeContext,
  type ComputedValue,
} from '@cube-track/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import {
  toComputedColumns,
  toComputedItem,
  todayIn,
  type BoardDefinition,
  type ItemSnapshotLike,
} from '../domain/board-definition.js';
import { BoardDefinitionRepository } from '../infrastructure/board-definition.repository.js';

const { memberships, users, teams, items } = schema;

/** Fórmulas usam o calendário só com funções de dias úteis: evita a consulta de feriados. */
const WORKDAY_FUNCTIONS = /WORKDAYS?\s*\(|ADD_WORKDAYS\s*\(/i;
/** Janela de feriados carregada para fórmulas (datas passadas e futuras usuais). */
const CALENDAR_YEARS_BACK = 5;

function expressionOf(settings: Readonly<Record<string, unknown>>): string {
  return typeof settings.expression === 'string' ? settings.expression : '';
}

export interface PreparedCompute {
  context: ComputeContext;
  today: string;
}

/**
 * Colunas calculadas do próprio item (fórmula e progresso por status), na mesma transação da
 * escrita (ADR 0038). Espelho/rollup são recalculados pelo worker.
 */
@Injectable()
export class ComputedFieldsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly definitions: BoardDefinitionRepository,
  ) {}

  async prepare(
    tenantId: string,
    definition: BoardDefinition,
    relatedItemIds: readonly string[] = [],
  ): Promise<PreparedCompute> {
    const tx = this.runner.tx;
    const timezone = await this.definitions.tenantTimezone(tx, tenantId);
    const today = todayIn(timezone);
    const formulas = definition.columns.filter((column) => column.type === 'formula');
    const expressions = formulas.map((column) => expressionOf(column.settings));
    const calendar = expressions.some((expression) => WORKDAY_FUNCTIONS.test(expression))
      ? await loadWorkingCalendar(
          tx,
          tenantId,
          definition.boardId,
          shiftDays(today, -366 * CALENDAR_YEARS_BACK),
        )
      : DEFAULT_CALENDAR;
    const names = await this.namesFor(definition, relatedItemIds);
    return {
      today,
      context: {
        today,
        now: new Date().toISOString(),
        calendar,
        ...(names === null ? {} : { names: (id: string) => names.get(id) }),
      },
    };
  }

  /** Recalcula fórmulas/progresso do item; devolve só as chaves alteradas. */
  compute(
    definition: BoardDefinition,
    prepared: PreparedCompute,
    item: ItemSnapshotLike & { id: string; createdAt: Date; updatedAt: Date },
  ): Map<string, ComputedValue | null> {
    if (
      !definition.columns.some((column) => column.type === 'formula' || column.type === 'progress')
    )
      return new Map();
    return computeItemColumns(
      toComputedColumns(definition),
      toComputedItem(item),
      prepared.context,
    );
  }

  /** Nomes de pessoas, times e itens relacionados — só quando alguma fórmula lê essas colunas. */
  private async namesFor(
    definition: BoardDefinition,
    relatedItemIds: readonly string[],
  ): Promise<Map<string, string> | null> {
    const referenced = definition.columns
      .filter((column) => column.type === 'formula')
      .map((column) => expressionOf(column.settings))
      .join(' ');
    const keysOf = (type: string) =>
      definition.columns.filter((column) => column.type === type).map((column) => column.key);
    const mentions = (keys: string[]) => keys.some((key) => referenced.includes(`{${key}}`));
    const needsPeople = mentions(keysOf('people'));
    const needsItems = mentions(keysOf('board_relation')) && relatedItemIds.length > 0;
    if (!needsPeople && !needsItems) return null;
    const tx = this.runner.tx;
    const names = new Map<string, string>();
    if (needsPeople) {
      const people = await tx
        .select({ id: users.id, name: users.name })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(isNull(memberships.deletedAt));
      for (const person of people) names.set(person.id, person.name);
      const teamRows = await tx
        .select({ id: teams.id, name: teams.name })
        .from(teams)
        .where(isNull(teams.deletedAt));
      for (const team of teamRows) names.set(team.id, team.name);
    }
    if (needsItems) {
      const rows = await tx
        .select({ id: items.id, name: items.name })
        .from(items)
        .where(and(inArray(items.id, [...relatedItemIds]), isNull(items.deletedAt)));
      for (const row of rows) names.set(row.id, row.name);
    }
    return names;
  }
}
