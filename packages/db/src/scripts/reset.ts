import { requireEnv } from '../env.js';
import { resetDatabase } from '../reset.js';

const result = await resetDatabase(requireEnv('DATABASE_URL'), {
  seed: !process.argv.includes('--no-seed'),
});
console.info(
  result === null
    ? 'Banco recriado (sem seed).'
    : `Banco recriado e populado: tenant ${result.tenantId}, board PMSP ${result.boardId ?? ''}.`,
);
