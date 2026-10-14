import type { TestProject } from 'vitest/node';
import pg from 'pg';

import '../src/env.js';
import { runMigrations } from '../src/migrate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    adminUrl: string;
    appUrl: string;
    readonlyUrl: string;
  }
}

const APP_ROLE = 'cube_test_app';
const RO_ROLE = 'cube_test_ro';
const PASSWORD = 'cube_test_password';

function withDatabase(url: string, database: string, user?: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  if (user !== undefined) {
    parsed.username = user;
    parsed.password = PASSWORD;
  }
  return parsed.toString();
}

async function adminQuery(url: string, text: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(text);
  } finally {
    await client.end();
  }
}

/**
 * Cria um banco isolado por execução, aplica as migrações como superusuário (migrator) e cria
 * papéis de login sem BYPASSRLS para os testes. Usa TEST_DATABASE_URL quando definido; caso
 * contrário, sobe um PostgreSQL via Testcontainers (requer Docker).
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let serverUrl = process.env.TEST_DATABASE_URL;
  let stopContainer: (() => Promise<unknown>) | undefined;
  if (serverUrl === undefined || serverUrl === '') {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const container = await new PostgreSqlContainer('postgres:16-alpine').start();
    serverUrl = container.getConnectionUri();
    stopContainer = () => container.stop();
  }

  const database = `cube_test_${process.pid}_${Date.now()}`;
  await adminQuery(serverUrl, `create database ${database}`);
  const adminUrl = withDatabase(serverUrl, database);
  await runMigrations(adminUrl);

  await adminQuery(
    adminUrl,
    `do $$ begin
       if not exists (select 1 from pg_roles where rolname = '${APP_ROLE}') then
         create role ${APP_ROLE} login password '${PASSWORD}' in role app_rw;
       end if;
       if not exists (select 1 from pg_roles where rolname = '${RO_ROLE}') then
         create role ${RO_ROLE} login password '${PASSWORD}' in role app_ro;
       end if;
     end $$;
     grant connect on database ${database} to ${APP_ROLE}, ${RO_ROLE};`,
  );

  project.provide('adminUrl', adminUrl);
  project.provide('appUrl', withDatabase(serverUrl, database, APP_ROLE));
  project.provide('readonlyUrl', withDatabase(serverUrl, database, RO_ROLE));

  return async () => {
    await adminQuery(serverUrl, `drop database if exists ${database} with (force)`);
    await stopContainer?.();
  };
}
