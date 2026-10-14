import type { TestProject } from 'vitest/node';

import '../src/env.js';
import { createTestDatabase } from '@cube-track/testing';

declare module 'vitest' {
  export interface ProvidedContext {
    adminUrl: string;
    appUrl: string;
    readonlyUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const database = await createTestDatabase('cube_db_test');
  project.provide('adminUrl', database.adminUrl);
  project.provide('appUrl', database.urls.app);
  project.provide('readonlyUrl', database.urls.readonly);
  return database.teardown;
}
