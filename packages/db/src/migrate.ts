import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDatabase } from './client.js';

export const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../migrations');

/** Aplica as migrações pendentes. Deve ser executado com o papel dono do schema (migrator). */
export async function runMigrations(connectionString: string): Promise<void> {
  const handle = createDatabase(connectionString, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await handle.close();
  }
}
