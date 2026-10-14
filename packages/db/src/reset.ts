import { sql } from 'drizzle-orm';

import { createDatabase } from './client.js';
import { runMigrations } from './migrate.js';
import { seedDemoCredentials } from './seed/credentials.js';
import { seedDemo, type DemoSeedResult } from './seed/demo.js';

/**
 * Apaga todos os objetos do banco (schemas public, app e drizzle), reaplica as migrações e o seed.
 * Proibido em produção. Papéis de cluster (app_rw, app_ro, platform_admin) são preservados.
 */
export async function resetDatabase(
  connectionString: string,
  options: { seed: boolean },
): Promise<DemoSeedResult | null> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:reset não pode ser executado com NODE_ENV=production.');
  }
  const handle = createDatabase(connectionString, { max: 1 });
  try {
    await handle.db.execute(sql`drop schema if exists drizzle cascade`);
    await handle.db.execute(sql`drop schema if exists app cascade`);
    await handle.db.execute(sql`drop schema if exists public cascade`);
    await handle.db.execute(sql`create schema public`);
  } finally {
    await handle.close();
  }
  await runMigrations(connectionString);
  if (!options.seed) return null;
  const seedHandle = createDatabase(connectionString, { max: 1 });
  try {
    const result = await seedDemo(seedHandle.db);
    await seedDemoCredentials(seedHandle.db);
    return result;
  } finally {
    await seedHandle.close();
  }
}
