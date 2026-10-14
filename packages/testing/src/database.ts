import pg from 'pg';

import { runMigrations } from '@cube-track/db';

/** Papéis de login criados para os testes (todos sem BYPASSRLS, exceto auth/relay — ADR 0028). */
export const TEST_ROLES = {
  app: { name: 'cube_test_app', group: 'app_rw' },
  readonly: { name: 'cube_test_ro', group: 'app_ro' },
  auth: { name: 'cube_test_auth', group: 'app_auth' },
  relay: { name: 'cube_test_relay', group: 'app_relay' },
} as const;
export type TestRole = keyof typeof TEST_ROLES;

const PASSWORD = 'cube_test_password';

export interface TestDatabase {
  adminUrl: string;
  urls: Record<TestRole, string>;
  teardown: () => Promise<void>;
}

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
 * Cria um banco isolado, aplica as migrações como dono e cria papéis de login para os testes
 * (ADR 0024). Usa `TEST_DATABASE_URL` (superusuário) ou sobe um PostgreSQL via Testcontainers.
 */
export async function createTestDatabase(prefix = 'cube_test'): Promise<TestDatabase> {
  let serverUrl = process.env.TEST_DATABASE_URL;
  let stopContainer: (() => Promise<unknown>) | undefined;
  if (serverUrl === undefined || serverUrl === '') {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const container = await new PostgreSqlContainer('postgres:16-alpine').start();
    serverUrl = container.getConnectionUri();
    stopContainer = () => container.stop();
  }
  const server = serverUrl;
  const database = `${prefix}_${process.pid}_${Date.now()}`;
  await adminQuery(server, `create database ${database}`);
  const adminUrl = withDatabase(server, database);
  await runMigrations(adminUrl);

  const statements = Object.values(TEST_ROLES)
    .map(
      (role) => `
      if not exists (select 1 from pg_roles where rolname = '${role.name}') then
        create role ${role.name} login password '${PASSWORD}' in role ${role.group};
      end if;`,
    )
    .join('\n');
  await adminQuery(
    adminUrl,
    `do $$ begin ${statements} end $$;
     grant connect on database ${database} to ${Object.values(TEST_ROLES)
       .map((role) => role.name)
       .join(', ')};`,
  );

  const urls = Object.fromEntries(
    Object.entries(TEST_ROLES).map(([key, role]) => [
      key,
      withDatabase(server, database, role.name),
    ]),
  ) as Record<TestRole, string>;

  return {
    adminUrl,
    urls,
    teardown: async () => {
      await adminQuery(server, `drop database if exists ${database} with (force)`);
      await stopContainer?.();
    },
  };
}
