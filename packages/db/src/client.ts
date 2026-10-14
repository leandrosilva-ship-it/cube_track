import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

/** Cria pool + instância Drizzle. Use `DATABASE_APP_URL` (papel sem BYPASSRLS) na aplicação. */
export function createDatabase(
  connectionString: string,
  options: pg.PoolConfig = {},
): DatabaseHandle {
  const pool = new pg.Pool({ connectionString, max: 10, ...options });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool, close: () => pool.end() };
}

export interface TenantContext {
  tenantId: string;
  userId?: string | null;
}

/**
 * Executa `work` numa transação com o contexto de tenant definido via `set_config(..., true)`
 * (local à transação, compatível com PgBouncer em modo transaction — ADR 0004).
 * Todo acesso a tabelas de negócio deve passar por aqui; sem contexto, o RLS nega tudo.
 */
export async function withTenant<T>(
  db: Database,
  context: TenantContext,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select app.set_context(${context.tenantId}::uuid, ${context.userId ?? null}::uuid)`,
    );
    return work(tx);
  });
}
