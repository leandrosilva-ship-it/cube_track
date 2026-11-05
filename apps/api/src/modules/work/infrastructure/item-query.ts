import {
  decodeCursor,
  encodeCursor,
  isDateToken,
  isFilterGroup,
  resolveDateToken,
  isUuidV7,
  sortSignature,
  type CursorValue,
  type FilterCondition,
  type FilterGroup,
  type SortTerm,
} from '@cube-track/shared';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import {
  ForbiddenError,
  UnprocessableError,
  ValidationError,
} from '../../../core/errors/problems.js';
import type { BoardColumn } from '../../access/infrastructure/access.repository.js';
import { orgUnitMatchCondition } from '../../access/infrastructure/org-match.js';

/**
 * Tradução da AST de filtros/ordenação (packages/shared/query.ts) para SQL sobre `items` (alias `i`).
 * Igualdade/contém usa o índice GIN de `values` (`@>`); faixas e ordenação usam a projeção tipada
 * `item_field_index` (ADR 0005/0020). Paginação por keyset com cursor opaco.
 */

type ValueType = 'text' | 'numeric' | 'date' | 'timestamptz' | 'uuid' | 'position' | 'boolean';

interface NativeField {
  expr: SQL;
  type: ValueType;
}

const NATIVE: Record<string, NativeField> = {
  name: { expr: sql`i.name`, type: 'text' },
  group_id: { expr: sql`i.group_id`, type: 'uuid' },
  position: { expr: sql`i.position`, type: 'position' },
  created_at: { expr: sql`i.created_at`, type: 'timestamptz' },
  updated_at: { expr: sql`i.updated_at`, type: 'timestamptz' },
  planned_start_date: { expr: sql`i.planned_start_date`, type: 'date' },
  planned_end_date: { expr: sql`i.planned_end_date`, type: 'date' },
  replanned_start_date: { expr: sql`i.replanned_start_date`, type: 'date' },
  replanned_end_date: { expr: sql`i.replanned_end_date`, type: 'date' },
  actual_start_date: { expr: sql`i.actual_start_date`, type: 'date' },
  actual_end_date: { expr: sql`i.actual_end_date`, type: 'date' },
  progress: { expr: sql`i.progress`, type: 'numeric' },
};

const NUMERIC_TYPES = new Set([
  'number',
  'rating',
  'time_tracking',
  'auto_id',
  'formula',
  'mirror',
  'progress',
  'rollup',
]);
const DATE_TYPES = new Set(['date', 'timeline', 'week']);
const TEXT_TYPES = new Set([
  'text',
  'long_text',
  'link',
  'email',
  'phone',
  'country',
  'color',
  'hour',
  'location',
]);

export interface ItemQueryInput {
  boardId: string;
  columns: readonly BoardColumn[];
  hiddenColumnKeys: ReadonlySet<string>;
  filter: FilterGroup | null;
  sort: SortTerm[];
  limit: number;
  cursor: string | undefined;
  groupId: string | undefined;
  parentItemId: string | null;
  includeArchived: boolean;
  currentUserId: string;
  currentUserTeamIds: readonly string[];
  /** Hoje (AAAA-MM-DD) no fuso do tenant: tokens de data e "atrasados". */
  today: string;
  /** Busca textual (nome e colunas de texto). */
  search: string | undefined;
  /** Somente itens arquivados (visão de arquivo). */
  archivedOnly: boolean;
  /** Inclui contagens de subitens, anexos e atualizações (não lidas) por linha. */
  withIndicators: boolean;
  /** Escopo de convidado: apenas itens atribuídos (pessoas/times) ou com concessão explícita. */
  assignedScope: {
    userId: string;
    teamIds: readonly string[];
    peopleKeys: readonly string[];
  } | null;
  /** Escopo de convidado "órgão" (ADR 0057): só itens cuja coluna `columnKey` tenha um valor igual a
   * `orgUnit`. Mutuamente exclusivo com `assignedScope` (um board resolve um único `itemScope`). */
  orgScope: {
    columnKey: string;
    orgUnit: string;
  } | null;
}

export interface CompiledItemQuery {
  query: SQL;
  signature: string;
  sortCount: number;
  limit: number;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);
const json = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;

const dateValue = z.iso.date();
const timestampValue = z.union([z.iso.datetime({ offset: true }), z.iso.date()]);
const numericValue = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]);

function bad(field: string, message: string): never {
  throw new ValidationError([{ path: `filter.${field}`, message }]);
}

function typedLiteral(type: ValueType, value: unknown, field: string): SQL {
  switch (type) {
    case 'numeric': {
      const parsed = numericValue.safeParse(value);
      if (!parsed.success) bad(field, 'Valor numérico esperado.');
      return sql`${String(parsed.data)}::numeric`;
    }
    case 'date': {
      const parsed = dateValue.safeParse(value);
      if (!parsed.success) bad(field, 'Data no formato AAAA-MM-DD esperada.');
      return sql`${parsed.data}::date`;
    }
    case 'timestamptz': {
      const parsed = timestampValue.safeParse(value);
      if (!parsed.success) bad(field, 'Data/hora ISO 8601 esperada.');
      return sql`${parsed.data}::timestamptz`;
    }
    case 'uuid':
      if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value))
        bad(field, 'UUID esperado.');
      return sql`${value}::uuid`;
    case 'boolean':
      if (typeof value !== 'boolean') bad(field, 'Booleano esperado.');
      return sql`${value}`;
    case 'text':
    case 'position':
      if (typeof value !== 'string' && typeof value !== 'number') bad(field, 'Texto esperado.');
      return sql`${String(value)}`;
  }
}

function list(value: FilterCondition['value']): (string | number | boolean)[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function compare(expr: SQL, type: ValueType, condition: FilterCondition): SQL {
  const { operator, value, field } = condition;
  const one = () => typedLiteral(type, Array.isArray(value) ? value[0] : value, field);
  switch (operator) {
    case 'is':
      return sql`${expr} = ${one()}`;
    case 'is_not':
      return sql`${expr} is distinct from ${one()}`;
    case 'gt':
    case 'after':
      return sql`${expr} > ${one()}`;
    case 'gte':
      return sql`${expr} >= ${one()}`;
    case 'lt':
    case 'before':
      return sql`${expr} < ${one()}`;
    case 'lte':
      return sql`${expr} <= ${one()}`;
    case 'between': {
      const values = list(value);
      if (values.length !== 2) bad(field, '"between" exige [início, fim].');
      return sql`${expr} between ${typedLiteral(type, values[0], field)} and ${typedLiteral(type, values[1], field)}`;
    }
    case 'any_of':
      return sql`${expr} in (${sql.join(
        list(value).map((entry) => typedLiteral(type, entry, field)),
        sql`, `,
      )})`;
    case 'none_of':
      return sql`${expr} not in (${sql.join(
        list(value).map((entry) => typedLiteral(type, entry, field)),
        sql`, `,
      )})`;
    case 'is_empty':
      return sql`${expr} is null`;
    case 'is_not_empty':
      return sql`${expr} is not null`;
    case 'overdue':
      return bad(field, 'Operador "overdue" só se aplica a datas.');
    case 'contains':
    case 'not_contains': {
      if (type !== 'text') bad(field, `Operador "${operator}" não se aplica a este campo.`);
      const like = sql`lower(${expr}) like ${`%${escapeLike(String(Array.isArray(value) ? value[0] : value).toLowerCase())}%`}`;
      return operator === 'contains' ? like : sql`not coalesce(${like}, false)`;
    }
  }
}

export class ItemQueryBuilder {
  private readonly columnsByKey: Map<string, BoardColumn>;
  private joinIndex = 0;
  private readonly joins: SQL[] = [];

  constructor(private readonly input: ItemQueryInput) {
    this.columnsByKey = new Map(input.columns.map((column) => [column.key, column]));
  }

  build(): CompiledItemQuery {
    const conditions: SQL[] = [
      sql`i.board_id = ${this.input.boardId}::uuid`,
      sql`i.deleted_at is null`,
    ];
    conditions.push(sql`g.deleted_at is null`);
    // Arquivo: itens arquivados ou de grupos arquivados.
    if (this.input.archivedOnly)
      conditions.push(sql`(i.archived_at is not null or g.archived_at is not null)`);
    else if (!this.input.includeArchived)
      conditions.push(sql`i.archived_at is null and g.archived_at is null`);
    const search = this.input.search?.trim() ?? '';
    if (search !== '') {
      const like = `%${escapeLike(search.toLowerCase())}%`;
      conditions.push(
        sql`(lower(i.name) like ${like} or exists (select 1 from item_field_index fs where fs.item_id = i.id and fs.v_text like ${like}))`,
      );
    }
    if (this.input.parentItemId === null) conditions.push(sql`i.parent_item_id is null`);
    else conditions.push(sql`i.parent_item_id = ${this.input.parentItemId}::uuid`);
    if (this.input.groupId !== undefined)
      conditions.push(sql`i.group_id = ${this.input.groupId}::uuid`);
    if (this.input.assignedScope !== null)
      conditions.push(this.assignedCondition(this.input.assignedScope));
    if (this.input.orgScope !== null) conditions.push(this.orgCondition(this.input.orgScope));
    if (this.input.filter !== null) conditions.push(this.compileGroup(this.input.filter));

    const terms: SortTerm[] = this.input.sort.length > 0 ? this.input.sort : [];

    // Caminho rápido: ordenar por exatamente uma coluna customizada projetada em `item_field_index`
    // (número/data/texto). Evita o `LEFT JOIN` entre `items` e `item_field_index` que impede o
    // planner de usar os índices compostos (`item_field_index_num_idx` e irmãos) para um top-N
    // indexado (ADR 0058 — ver `buildProjectedSortQuery`). Ordenação nativa, por status/checkbox ou
    // com múltiplos termos segue o caminho genérico abaixo, inalterado.
    if (terms.length === 1) {
      const target = this.projectedSortTarget(terms[0]?.field ?? '');
      if (target !== null)
        return this.buildProjectedSortQuery(
          conditions,
          target.column,
          target.projection,
          terms[0]?.direction ?? 'asc',
        );
    }

    const sortExprs =
      terms.length > 0
        ? terms.map((term) => ({
            ...this.sortExpression(term.field, term.direction),
            direction: term.direction,
          }))
        : this.defaultSort();
    const signature = sortSignature(terms);

    if (this.input.cursor !== undefined) {
      const cursor = decodeCursor(this.input.cursor, signature);
      if (cursor?.keys.length !== sortExprs.length || !isUuidV7(cursor.id)) {
        throw new ValidationError([
          { path: 'query.cursor', message: 'Cursor inválido para esta consulta.' },
        ]);
      }
      conditions.push(this.keyset(sortExprs, cursor.keys, cursor.id));
    }

    const select = sortExprs.map(
      (term, index) => sql`(${term.expr})::text as ${sql.identifier(`sort_${index}`)}`,
    );
    const order = sortExprs.map((term) =>
      term.direction === 'asc' ? sql`${term.expr} asc` : sql`${term.expr} desc`,
    );
    const query = sql`
      select ${this.itemRowColumns()},
             ${this.input.withIndicators ? this.indicatorColumns() : sql``}
             ${sql.join(select, sql`, `)}
      from items i
      join groups g on g.id = i.group_id
      ${sql.join(this.joins, sql` `)}
      where ${sql.join(conditions, sql` and `)}
      order by ${sql.join(order, sql`, `)}, i.id asc
      limit ${this.input.limit + 1}`;
    return { query, signature, sortCount: sortExprs.length, limit: this.input.limit };
  }

  /** Lista de colunas de um item, compartilhada entre o caminho genérico e o top-N por coluna
   * customizada (`buildProjectedSortQuery`) — mesma forma de linha em ambos, consumida por
   * `rowToItem` (`items.repository.ts`). */
  private itemRowColumns(): SQL {
    return sql`i.id, i.tenant_id, i.board_id, i.group_id, i.parent_item_id, i.name, i.position, i.values, i.field_versions,
             i.version, i.description_text,
             i.planned_start_date::text as planned_start_date, i.planned_end_date::text as planned_end_date,
             i.replanned_start_date::text as replanned_start_date, i.replanned_end_date::text as replanned_end_date,
             i.actual_start_date::text as actual_start_date, i.actual_end_date::text as actual_end_date,
             i.progress::text as progress, i.is_milestone, i.schedule_mode,
             i.created_at, i.updated_at, i.created_by, i.updated_by,
             i.completed_at, i.archived_at`;
  }

  /**
   * Quando um único termo de ordenação cai na projeção de `item_field_index` (número/data/texto —
   * não nativo, não vinculado a outro módulo, não status/checkbox), devolve a coluna e a projeção
   * para `buildProjectedSortQuery`. `null` quando o termo deve seguir o caminho genérico (nativo,
   * status, checkbox) — nesse caso `sortExpression` refaz a mesma validação (erro idêntico,
   * nenhuma mudança de comportamento). Nunca tem efeito colateral (não empilha `joins`).
   */
  private projectedSortTarget(
    field: string,
  ): { column: BoardColumn; projection: { column: 'v_num' | 'v_date' | 'v_text'; type: ValueType } } | null {
    const native =
      NATIVE[field] ?? (field in NATIVE ? undefined : this.bindingField(this.columnIfExists(field)));
    if (native !== undefined && native !== null) return null;
    const column = this.column(field);
    if (column.type === 'status' || column.type === 'checkbox') return null;
    const projection = this.projectionFor(column);
    if (projection === null) return null;
    return { column, projection };
  }

  /**
   * Top-N em duas etapas para ordenar por uma coluna customizada sem o `LEFT JOIN` que impede o
   * planner de usar `item_field_index_num_idx`/`_date_idx`/`_text_idx` (ADR 0058,
   * `tools/load/README.md`): `branch_a` resolve, com `INNER JOIN` + `ORDER BY ... LIMIT`, os itens
   * que TÊM valor na coluna — caminho que o planner pode satisfazer com um índice composto
   * `(board_id, column_key, valor, item_id)` em vez de materializar o board inteiro. `branch_b`
   * cobre os itens SEM valor (sempre ordenados por último, em qualquer direção — mesma regra de
   * `nullSafe`) e só é executado quando `branch_a` não preenche a página sozinha (join lateral
   * guardado por uma contagem — nunca paga o anti-join quando todo item tem valor). O resultado
   * final (união + reordenação + limite) é idêntico ao da consulta antiga: mesma paginação por
   * cursor (`sort_0` com a mesma codificação de `nullSafe`), mesmos filtros e mesmo escopo —
   * apenas a forma física da consulta muda.
   */
  private buildProjectedSortQuery(
    conditions: SQL[],
    column: BoardColumn,
    projection: { column: 'v_num' | 'v_date' | 'v_text'; type: ValueType },
    direction: 'asc' | 'desc',
  ): CompiledItemQuery {
    const key = column.key;
    const limit = this.input.limit;
    const signature = sortSignature(this.input.sort);
    const generic = this.nullSafe(sql`f.${sql.identifier(projection.column)}`, projection.type, direction);
    if (this.input.cursor !== undefined) {
      const cursor = decodeCursor(this.input.cursor, signature);
      if (cursor?.keys.length !== 1 || !isUuidV7(cursor.id)) {
        throw new ValidationError([
          { path: 'query.cursor', message: 'Cursor inválido para esta consulta.' },
        ]);
      }
      conditions.push(this.keyset([{ ...generic, direction }], cursor.keys, cursor.id));
    }
    const where = sql.join(conditions, sql` and `);
    const indicators = this.input.withIndicators ? this.indicatorColumns() : sql``;
    const rows = this.itemRowColumns();
    const orderDir = direction === 'asc' ? sql`asc` : sql`desc`;
    const branchA = sql`
      select ${rows}, ${indicators} ${this.branchSortColumn(projection, direction, true)}
      from items i
      join groups g on g.id = i.group_id
      join item_field_index f on f.item_id = i.id and f.board_id = i.board_id and f.column_key = ${key}
      where ${where}
      order by f.${sql.identifier(projection.column)} ${orderDir}, i.id asc
      limit ${limit + 1}`;
    const branchB = sql`
      select ${rows}, ${indicators} ${this.branchSortColumn(projection, direction, false)}
      from items i
      join groups g on g.id = i.group_id
      left join item_field_index f on f.item_id = i.id and f.board_id = i.board_id and f.column_key = ${key}
      where ${where} and f.item_id is null
      order by i.id asc
      limit ${limit + 1}`;
    // `branch_a` precisa de `materialized`: é referenciada duas vezes (a contagem-guarda e a união)
    // e sem isso o Postgres poderia inliná-la e executá-la duas vezes. `branch_b` fica como
    // subconsulta lateral comum (nunca materializada) — o join lateral com a guarda de contagem faz
    // o Postgres não executá-la quando `branch_a` já preenche a página (confirmado via
    // `EXPLAIN ANALYZE`: "never executed" nesse caso).
    const query = sql`
      with branch_a as materialized (${branchA})
      select *, (sort_typed)::text as sort_0 from (
        select * from branch_a
        union all
        select b.* from (
          select 1 from (select count(*) as n from branch_a) c where c.n < ${limit + 1}
        ) guard
        cross join lateral (${branchB}) b
      ) combined
      order by sort_typed ${orderDir}, id asc
      limit ${limit + 1}`;
    return { query, signature, sortCount: 1, limit };
  }

  /** Valor de ordenação de um ramo do top-N (ver `buildProjectedSortQuery`): com valor, a própria
   * coluna projetada (ou, para texto, o mesmo prefixo de `nullSafe`, sempre não-nulo neste ramo);
   * sem valor, a sentinela que `nullSafe` usaria para nulo — nulos sempre por último. */
  private branchSortColumn(
    projection: { column: 'v_num' | 'v_date' | 'v_text'; type: ValueType },
    direction: 'asc' | 'desc',
    hasValue: boolean,
  ): SQL {
    const asc = direction === 'asc';
    const col = sql`f.${sql.identifier(projection.column)}`;
    if (projection.type === 'numeric')
      return hasValue
        ? sql`(${col})::numeric as sort_typed`
        : sql`${asc ? 'Infinity' : '-Infinity'}::numeric as sort_typed`;
    if (projection.type === 'date')
      return hasValue
        ? sql`(${col})::date as sort_typed`
        : sql`${asc ? 'infinity' : '-infinity'}::date as sort_typed`;
    // texto: mesmo esquema de prefixo de nullSafe() — nulos sempre por último, em qualquer direção.
    return hasValue
      ? sql`(${asc ? sql`'0' || ${col}` : sql`'1' || ${col}`})::text as sort_typed`
      : sql`${asc ? sql`'1'` : sql`'0'`}::text as sort_typed`;
  }

  /** Cursor da próxima página a partir da última linha retornada. */
  static nextCursor(row: Record<string, unknown>, signature: string, sortCount: number): string {
    const keys: CursorValue[] = [];
    for (let index = 0; index < sortCount; index += 1)
      keys.push((row[`sort_${index}`] as string | null) ?? null);
    return encodeCursor({ sort: signature, keys, id: String(row.id) });
  }

  /** Contagens por linha para os indicadores da Tabela (índices por item em cada tabela). */
  private indicatorColumns(): SQL {
    const userId = this.input.currentUserId;
    return sql`
      (select count(*) from items s where s.parent_item_id = i.id and s.deleted_at is null and s.archived_at is null)::int as subitem_count,
      (select count(*) from attachments a where a.item_id = i.id and a.deleted_at is null)::int as attachment_count,
      (select count(*) from updates u where u.item_id = i.id and u.deleted_at is null)::int as update_count,
      (select count(*) from updates u
         where u.item_id = i.id and u.deleted_at is null and u.author_id is distinct from ${userId}::uuid
           and u.created_at > coalesce(
             (select r.last_seen_at from item_reads r where r.item_id = i.id and r.user_id = ${userId}::uuid),
             '-infinity'::timestamptz))::int as unread_count,`;
  }

  // ---------------------------------------------------------------------------------- filtro ---

  /** Tokens de período ("hoje", "esta semana"…) viram intervalos; "atrasados" exige item aberto. */
  private dateCondition(expr: SQL, type: ValueType, condition: FilterCondition): SQL {
    if (condition.operator === 'overdue')
      return sql`(${expr} < ${this.input.today}::date and i.completed_at is null)`;
    const first = Array.isArray(condition.value) ? condition.value[0] : condition.value;
    if (!isDateToken(first)) return compare(expr, type, condition);
    const range = resolveDateToken(first, this.input.today);
    const within = sql`${expr} between ${range.from}::date and ${range.to}::date`;
    switch (condition.operator) {
      case 'is':
      case 'any_of':
      case 'between':
        return within;
      case 'is_not':
      case 'none_of':
        return sql`not coalesce(${within}, false)`;
      case 'before':
      case 'lt':
        return sql`${expr} < ${range.from}::date`;
      case 'lte':
        return sql`${expr} <= ${range.to}::date`;
      case 'after':
      case 'gt':
        return sql`${expr} > ${range.to}::date`;
      case 'gte':
        return sql`${expr} >= ${range.from}::date`;
      default:
        return compare(expr, type, condition);
    }
  }

  private nativeCondition(native: NativeField, condition: FilterCondition): SQL {
    if (native.type === 'date') return this.dateCondition(native.expr, native.type, condition);
    if (
      native.type === 'timestamptz' &&
      (condition.operator === 'overdue' ||
        isDateToken(Array.isArray(condition.value) ? condition.value[0] : condition.value))
    )
      return this.dateCondition(sql`(${native.expr})::date`, 'date', condition);
    return compare(native.expr, native.type, condition);
  }

  private compileGroup(group: FilterGroup): SQL {
    if (group.conditions.length === 0) return sql`true`;
    const parts = group.conditions.map((node) =>
      isFilterGroup(node) ? this.compileGroup(node) : this.compileCondition(node),
    );
    return sql`(${sql.join(parts, group.op === 'and' ? sql` and ` : sql` or `)})`;
  }

  private compileCondition(condition: FilterCondition): SQL {
    const native = NATIVE[condition.field];
    if (native !== undefined) return this.nativeCondition(native, condition);
    const column = this.column(condition.field);
    const nativeByBinding = this.bindingField(column);
    if (nativeByBinding !== null) return this.nativeCondition(nativeByBinding, condition);
    const key = column.key;
    const present = sql`(i.values ? ${key})`;
    if (condition.operator === 'is_empty') return sql`not ${present}`;
    if (condition.operator === 'is_not_empty') return present;
    const values = list(condition.value);

    const containment = (builder: (value: string | number | boolean) => unknown) => {
      if (values.length === 0) bad(condition.field, 'Informe ao menos um valor.');
      return sql`(${sql.join(
        values.map((value) => sql`i.values @> ${json({ [key]: builder(value) })}`),
        sql` or `,
      )})`;
    };

    switch (column.type) {
      case 'status': {
        const any = containment((value) => ({ labelId: String(value) }));
        if (['is', 'any_of'].includes(condition.operator)) return any;
        if (['is_not', 'none_of'].includes(condition.operator)) return sql`not ${any}`;
        break;
      }
      case 'dropdown':
      case 'people':
      case 'tags':
      case 'board_relation': {
        const property = {
          dropdown: 'optionIds',
          people: 'personIds',
          tags: 'tags',
          board_relation: 'itemIds',
        }[column.type];
        const me = column.type === 'people' && list(condition.value).includes('me');
        const any = me
          ? sql`(${containment((value) => ({ [property]: [value === 'me' ? this.input.currentUserId : value] }))}${sql.join(
              this.input.currentUserTeamIds.map(
                (teamId) => sql` or i.values @> ${json({ [key]: { teamIds: [teamId] } })}`,
              ),
              sql``,
            )})`
          : containment((value) => ({ [property]: [value] }));
        if (['is', 'any_of', 'contains'].includes(condition.operator)) return any;
        if (['is_not', 'none_of', 'not_contains'].includes(condition.operator))
          return sql`not ${any}`;
        break;
      }
      case 'checkbox':
        if (condition.operator === 'is') {
          return sql`coalesce((i.values -> ${key} ->> 'checked')::boolean, false) = ${typedLiteral('boolean', condition.value, condition.field)}`;
        }
        break;
      default: {
        const projection = this.projectionFor(column);
        if (projection !== null) {
          // A projeção de texto é armazenada em minúsculas.
          const normalized: FilterCondition =
            projection.type === 'text' && condition.value !== undefined && condition.value !== null
              ? {
                  ...condition,
                  value: Array.isArray(condition.value)
                    ? condition.value.map((entry) => String(entry).toLowerCase())
                    : String(condition.value).toLowerCase(),
                }
              : condition;
          const projected = sql`f.${sql.identifier(projection.column)}`;
          const inner =
            projection.type === 'date'
              ? this.dateCondition(projected, 'date', normalized)
              : compare(projected, projection.type, normalized);
          return sql`exists (select 1 from item_field_index f where f.item_id = i.id and f.column_key = ${key} and ${inner})`;
        }
      }
    }
    throw new UnprocessableError(
      `Operador "${condition.operator}" não suportado para a coluna "${column.key}".`,
      'filter_unsupported',
    );
  }

  private assignedCondition(scope: NonNullable<ItemQueryInput['assignedScope']>): SQL {
    const parts: SQL[] = [];
    for (const key of scope.peopleKeys) {
      parts.push(sql`i.values @> ${json({ [key]: { personIds: [scope.userId] } })}`);
      for (const teamId of scope.teamIds)
        parts.push(sql`i.values @> ${json({ [key]: { teamIds: [teamId] } })}`);
    }
    parts.push(sql`exists (
      select 1 from access_grants ag
      where ag.resource_type = 'item' and ag.resource_id = i.id
        and ((ag.principal_type = 'user' and ag.principal_id = ${scope.userId}::uuid)
          ${
            scope.teamIds.length === 0
              ? sql``
              : sql`or (ag.principal_type = 'team' and ag.principal_id in (${sql.join(
                  scope.teamIds.map((id) => sql`${id}::uuid`),
                  sql`, `,
                )}))`
          })
        and (ag.expires_at is null or ag.expires_at > now()))`);
    return sql`(${sql.join(parts, sql` or `)})`;
  }

  /** Escopo "órgão" (ADR 0057) — mesmo comparador usado para um item isolado
   * (`AccessRepository.itemMatchesOrgUnit`), nunca uma segunda implementação. Coluna removida depois
   * de configurada (não encontrada em `columnsByKey`) nega tudo: fail-safe, nunca fail-open. */
  private orgCondition(scope: NonNullable<ItemQueryInput['orgScope']>): SQL {
    const column = this.columnsByKey.get(scope.columnKey);
    if (column === undefined) return sql`false`;
    return orgUnitMatchCondition({
      itemId: sql`i.id`,
      values: sql`i.values`,
      column,
      orgUnit: scope.orgUnit,
    });
  }

  // ------------------------------------------------------------------------------- ordenação ---

  private defaultSort() {
    return [
      { expr: sql`g.position`, type: 'position' as const, direction: 'asc' as const },
      { expr: sql`i.position`, type: 'position' as const, direction: 'asc' as const },
    ];
  }

  private sortExpression(field: string, direction: 'asc' | 'desc'): { expr: SQL; type: ValueType } {
    const native =
      NATIVE[field] ??
      (field in NATIVE ? undefined : this.bindingField(this.columnIfExists(field)));
    if (native !== undefined && native !== null)
      return this.nullSafe(
        field === 'name' ? sql`lower(${native.expr})` : native.expr,
        native.type,
        direction,
      );
    const column = this.column(field);
    const alias = `s${this.joinIndex++}`;
    if (column.type === 'status') {
      this.joins.push(
        sql`left join status_labels ${sql.identifier(alias)} on ${sql.identifier(alias)}.id = nullif(i.values -> ${column.key} ->> 'labelId', '')::uuid`,
      );
      return this.nullSafe(sql`${sql.identifier(alias)}.position`, 'position', direction);
    }
    if (column.type === 'checkbox')
      return this.nullSafe(
        sql`(i.values -> ${column.key} ->> 'checked')::boolean`,
        'boolean',
        direction,
      );
    const projection = this.projectionFor(column);
    if (projection === null)
      throw new UnprocessableError(
        `A coluna "${column.key}" não permite ordenação.`,
        'sort_unsupported',
      );
    this.joins.push(
      sql`left join item_field_index ${sql.identifier(alias)} on ${sql.identifier(alias)}.item_id = i.id and ${sql.identifier(alias)}.column_key = ${column.key}`,
    );
    return this.nullSafe(
      sql`${sql.identifier(alias)}.${sql.identifier(projection.column)}`,
      projection.type,
      direction,
    );
  }

  /** Expressão de ordenação sem nulos (nulos sempre por último em qualquer direção), estável para o keyset. */
  private nullSafe(
    expr: SQL,
    type: ValueType,
    direction: 'asc' | 'desc',
  ): { expr: SQL; type: ValueType } {
    const asc = direction === 'asc';
    switch (type) {
      case 'numeric':
        return { expr: sql`coalesce(${expr}, ${asc ? 'Infinity' : '-Infinity'}::numeric)`, type };
      case 'date':
        return { expr: sql`coalesce(${expr}, ${asc ? 'infinity' : '-infinity'}::date)`, type };
      case 'timestamptz':
        return {
          expr: sql`coalesce(${expr}, ${asc ? 'infinity' : '-infinity'}::timestamptz)`,
          type,
        };
      case 'boolean':
        return { expr: sql`coalesce(${expr}::int, ${asc ? 2 : -1})`, type: 'numeric' };
      case 'uuid':
      case 'text':
      case 'position': {
        // Prefixo: em ordem crescente valores '0…' e nulos '1'; em decrescente valores '1…' e nulos '0'.
        const value = type === 'uuid' ? sql`${expr}::text` : expr;
        return {
          expr: asc
            ? sql`(case when ${expr} is null then '1' else '0' || ${value} end)`
            : sql`(case when ${expr} is null then '0' else '1' || ${value} end)`,
          type: type === 'uuid' ? 'text' : type,
        };
      }
    }
  }

  private keyset(
    terms: { expr: SQL; type: ValueType; direction: 'asc' | 'desc' }[],
    keys: CursorValue[],
    id: string,
  ): SQL {
    const literal = (type: ValueType, value: CursorValue): SQL => {
      if (value === null) return sql`null`;
      switch (type) {
        case 'numeric':
          return sql`${String(value)}::numeric`;
        case 'date':
          return sql`${String(value)}::date`;
        case 'timestamptz':
          return sql`${String(value)}::timestamptz`;
        case 'position':
          return sql`${String(value)} collate "C"`;
        default:
          return sql`${String(value)}`;
      }
    };
    const branches: SQL[] = [];
    for (let index = 0; index <= terms.length; index += 1) {
      const equals = terms
        .slice(0, index)
        .map((term, position) => sql`${term.expr} = ${literal(term.type, keys[position] ?? null)}`);
      const term = terms[index];
      const tail =
        term === undefined
          ? sql`i.id > ${id}::uuid`
          : term.direction === 'asc'
            ? sql`${term.expr} > ${literal(term.type, keys[index] ?? null)}`
            : sql`${term.expr} < ${literal(term.type, keys[index] ?? null)}`;
      branches.push(sql`(${sql.join([...equals, tail], sql` and `)})`);
    }
    return sql`(${sql.join(branches, sql` or `)})`;
  }

  // ------------------------------------------------------------------------------ utilitários ---

  private columnIfExists(key: string): BoardColumn | null {
    return this.columnsByKey.get(key) ?? null;
  }

  private column(key: string): BoardColumn {
    const column = this.columnsByKey.get(key);
    if (column === undefined)
      throw new ValidationError([{ path: `filter.${key}`, message: 'Campo desconhecido.' }]);
    if (this.input.hiddenColumnKeys.has(key)) {
      throw new ForbiddenError(
        `Sem permissão para filtrar ou ordenar pela coluna "${key}".`,
        'column_forbidden',
      );
    }
    return column;
  }

  private bindingField(column: BoardColumn | null): NativeField | null {
    const binding = column?.binding ?? null;
    if (column === null || binding === null) return null;
    if (this.input.hiddenColumnKeys.has(column.key)) {
      throw new ForbiddenError(
        `Sem permissão para filtrar ou ordenar pela coluna "${column.key}".`,
        'column_forbidden',
      );
    }
    if (!binding.startsWith('item.')) {
      throw new UnprocessableError(
        `A coluna "${column.key}" é vinculada a um módulo e ainda não é filtrável.`,
        'field_not_filterable',
      );
    }
    return NATIVE[binding.slice('item.'.length)] ?? null;
  }

  private projectionFor(
    column: BoardColumn,
  ): { column: 'v_num' | 'v_date' | 'v_text'; type: ValueType } | null {
    if (NUMERIC_TYPES.has(column.type)) return { column: 'v_num', type: 'numeric' };
    if (DATE_TYPES.has(column.type)) return { column: 'v_date', type: 'date' };
    if (TEXT_TYPES.has(column.type)) return { column: 'v_text', type: 'text' };
    return null;
  }
}
