import { requireEnv } from '../env.js';
import { runMigrations } from '../migrate.js';

const url = requireEnv('DATABASE_URL');
await runMigrations(url);
console.info('Migrações aplicadas com sucesso.');
