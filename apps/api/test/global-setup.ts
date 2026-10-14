import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabase, seedDemo, seedDemoCredentials } from '@cube-track/db';
import { createTestDatabase } from '@cube-track/testing';
import { Redis } from 'ioredis';
import S3rver from 's3rver';
import type { TestProject } from 'vitest/node';

import '../../../packages/db/src/env.js';

declare module 'vitest' {
  export interface ProvidedContext {
    adminUrl: string;
    appUrl: string;
    authUrl: string;
    relayUrl: string;
    redisUrl: string;
    meiliUrl: string;
    meiliKey: string;
    s3Endpoint: string;
  }
}

/**
 * Infra de integração: banco isolado com migrações + seed da Empresa Demo (papel dono), Redis em um
 * DB lógico dedicado e um S3 fake (s3rver). Meilisearch vem de TEST_MEILI_URL (CI: service container).
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const database = await createTestDatabase('cube_api_test');
  const admin = createDatabase(database.adminUrl, { max: 1 });
  await seedDemo(admin.db);
  await seedDemoCredentials(admin.db);
  await admin.close();

  const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/13';
  const redis = new Redis(redisUrl);
  await redis.flushdb();
  await redis.quit();

  const directory = await mkdtemp(join(tmpdir(), 'cube-s3-'));
  const s3 = new S3rver({
    port: 0,
    address: '127.0.0.1',
    directory,
    silent: true,
    configureBuckets: [{ name: 'cubetrack-test' }],
  });
  const { port } = await s3.run();

  project.provide('adminUrl', database.adminUrl);
  project.provide('appUrl', database.urls.app);
  project.provide('authUrl', database.urls.auth);
  project.provide('relayUrl', database.urls.relay);
  project.provide('redisUrl', redisUrl);
  project.provide('meiliUrl', process.env.TEST_MEILI_URL ?? 'http://localhost:7700');
  project.provide(
    'meiliKey',
    process.env.TEST_MEILI_KEY ?? process.env.MEILI_API_KEY ?? 'cubetrack-dev-master-key',
  );
  project.provide('s3Endpoint', `http://127.0.0.1:${port}`);

  return async () => {
    await s3.close();
    await rm(directory, { recursive: true, force: true });
    await database.teardown();
  };
}
