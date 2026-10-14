import { newId } from '@cube-track/shared';
import { sql } from 'drizzle-orm';
import { inject } from 'vitest';

import { createDatabase, withTenant, type Database, type DatabaseHandle } from '../src/client.js';
import { provisionTenant } from '../src/provisioning.js';
import {
  boards,
  columnDefinitions,
  groups,
  items,
  memberships,
  workspaces,
} from '../src/schema/index.js';
import { seedDemo } from '../src/seed/demo.js';

export const appDatabase = (): DatabaseHandle => createDatabase(inject('appUrl'), { max: 2 });
export const adminDatabase = (): DatabaseHandle => createDatabase(inject('adminUrl'), { max: 2 });
export const readonlyDatabase = (): DatabaseHandle =>
  createDatabase(inject('readonlyUrl'), { max: 1 });

/** Código SQLSTATE de um erro do driver `pg` (embrulhado ou não pelo Drizzle). */
export function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth += 1) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

export async function expectPgError(promise: Promise<unknown>, codes: string[]): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const code = pgCode(error);
    if (code !== undefined && codes.includes(code)) return code;
    throw error;
  }
  throw new Error(`Esperava erro ${codes.join('/')}, mas a operação foi concluída.`);
}

export interface SmallTenant {
  tenantId: string;
  userId: string;
  workspaceId: string;
  boardId: string;
  groupId: string;
  itemId: string;
}

/** Garante o tenant de demonstração (seed executado com o papel da aplicação, sob RLS). */
export async function ensureDemo(db: Database): Promise<string> {
  const result = await seedDemo(db);
  return result.tenantId;
}

/** Cria um tenant mínimo (workspace, board, grupo, item) para testes de isolamento. */
export async function createSmallTenant(db: Database, slug: string): Promise<SmallTenant> {
  const tenantId = newId();
  return withTenant(db, { tenantId }, async (tx) => {
    const provisioned = await provisionTenant(tx, { id: tenantId, name: `Tenant ${slug}`, slug });
    const userRow = await tx.execute<{ id: string }>(
      sql`select app.ensure_user(${`owner@${slug}.example.com`}, ${`Owner ${slug}`}) as id`,
    );
    const userId = userRow.rows[0]?.id ?? '';
    await tx
      .insert(memberships)
      .values({ tenantId, userId, roleId: provisioned.roleIds.owner ?? '' });
    const workspaceId = newId();
    await tx
      .insert(workspaces)
      .values({ id: workspaceId, tenantId, name: 'Workspace', position: 'a0' });
    const boardId = newId();
    await tx
      .insert(boards)
      .values({ id: boardId, tenantId, workspaceId, name: 'Board', position: 'a0' });
    const groupId = newId();
    await tx
      .insert(groups)
      .values({ id: groupId, tenantId, boardId, name: 'Grupo', position: 'a0' });
    await tx.insert(columnDefinitions).values({
      tenantId,
      boardId,
      key: 'c_id',
      type: 'auto_id',
      title: 'ID',
      settings: { mask: 'T-{SEQ:3}', resetPeriod: 'never' },
      position: 'a0',
    });
    const itemId = newId();
    await tx
      .insert(items)
      .values({ id: itemId, tenantId, boardId, groupId, name: `Item ${slug}`, position: 'a0' });
    return { tenantId, userId, workspaceId, boardId, groupId, itemId };
  });
}
