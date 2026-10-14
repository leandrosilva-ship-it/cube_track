import { createHash } from 'node:crypto';

import { newId } from '@cube-track/shared';
import { sql } from 'drizzle-orm';
import {
  customType,
  foreignKey,
  pgTable,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
  type PgColumn,
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';
import type { BuildExtraConfigColumns } from 'drizzle-orm';

import { tenants } from './_tenants.js';

/** Posição manual (fractional indexing, ADR 0013). Ordenação binária via `COLLATE "C"`. */
export const position = customType<{ data: string }>({
  dataType: () => 'text COLLATE "C"',
});

/** Valores monetários e UST: `numeric(18,4)`, trafegam como string (ADR 0019). */
export const MONEY = { precision: 18, scale: 4 } as const;

export const pk = () =>
  uuid('id')
    .primaryKey()
    .default(sql`app.uuid_v7()`)
    .$defaultFn(newId);

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const deletedAt = () => timestamp('deleted_at', { withTimezone: true });

export const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

/** Colunas padrão de toda tabela de negócio. */
export const baseColumns = () => ({
  id: pk(),
  tenantId: tenantId(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: uuid('created_by'),
});

/** Colunas padrão de tabelas append-only (sem updated_at). */
export const appendOnlyColumns = () => ({
  id: pk(),
  tenantId: tenantId(),
  createdAt: createdAt(),
  createdBy: uuid('created_by'),
});

type TenantColumns = ReturnType<typeof baseColumns> | ReturnType<typeof appendOnlyColumns>;

/**
 * Tabela de negócio com isolamento por tenant: aplica colunas padrão e a chave única
 * `(tenant_id, id)`, alvo das FKs compostas que impedem referências entre tenants (ADR 0004).
 */
export function tenantTable<
  TName extends string,
  TColumns extends Record<string, PgColumnBuilderBase>,
  TBase extends TenantColumns = ReturnType<typeof baseColumns>,
>(
  name: TName,
  columns: TColumns,
  extra?: (
    self: BuildExtraConfigColumns<TName, TBase & TColumns, 'pg'>,
  ) => PgTableExtraConfigValue[],
  base?: TBase,
) {
  const allColumns = { ...(base ?? baseColumns()), ...columns } as TBase & TColumns;
  return pgTable(name, allColumns, (self) => [
    unique(`${name}_tenant_id_id_key`).on(self.tenantId, self.id),
    ...(extra?.(self) ?? []),
  ]);
}

/** Nome de constraint respeitando o limite de 63 bytes do PostgreSQL. */
export function constraintName(...parts: string[]): string {
  const name = parts.join('_');
  if (name.length <= 63) return name;
  const hash = createHash('sha1').update(name).digest('hex').slice(0, 8);
  return `${name.slice(0, 54)}_${hash}`;
}

type FkAction = 'cascade' | 'restrict' | 'no action' | 'set null';

/**
 * FK composta `(tenant_id, coluna) → alvo(tenant_id, id)`.
 * Com MATCH SIMPLE (padrão), colunas nulas não são verificadas.
 */
export function tenantFk(
  table: string,
  tenantColumn: PgColumn,
  column: PgColumn,
  target: { tenantId: AnyPgColumn; id: AnyPgColumn },
  onDelete: FkAction = 'cascade',
) {
  const fk = foreignKey({
    name: constraintName(table, column.name, 'fk'),
    columns: [tenantColumn, column],
    foreignColumns: [target.tenantId, target.id],
  });
  // "set null" em FK composta anularia também tenant_id (NOT NULL); usamos SET NULL apenas na coluna.
  return onDelete === 'set null'
    ? fk.onDelete(`set null ("${column.name}")` as 'set null')
    : fk.onDelete(onDelete);
}
