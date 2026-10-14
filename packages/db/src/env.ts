import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config } from 'dotenv';

const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) config({ path: rootEnv, quiet: true });

/** Lê uma variável de ambiente obrigatória. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}
