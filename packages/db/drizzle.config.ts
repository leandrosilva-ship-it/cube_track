import { readdirSync } from 'node:fs';

import { defineConfig } from 'drizzle-kit';

// audit_logs é particionada e criada por SQL manual (ADR 0015/0021): `audit.ts` fica fora do diff.
const schemaFiles = readdirSync('./src/schema')
  .filter((file) => file.endsWith('.ts') && file !== 'index.ts' && file !== 'audit.ts')
  .map((file) => `./src/schema/${file}`);

export default defineConfig({
  dialect: 'postgresql',
  schema: schemaFiles,
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://cubetrack:cubetrack@localhost:5432/cubetrack',
  },
  strict: true,
  verbose: true,
});
