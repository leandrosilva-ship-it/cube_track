import { schema, withTenant, type DatabaseHandle, type Transaction } from '@cube-track/db';
import {
  DomainEventJobSchema,
  SEARCH_INDEX_SETTINGS,
  SEARCH_INDEXES,
  SearchIndexJobSchema,
  type BoardSearchDocument,
  type ItemSearchDocument,
  type SearchIndexJob,
  type SearchIndexName,
  type UpdateSearchDocument,
} from '@cube-track/shared';
import type { Job } from 'bullmq';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { MeiliSearch } from 'meilisearch';

const { items, boards, groups, updates, columnDefinitions } = schema;
const BATCH = 500;

/** Cria os índices e aplica as configurações (idempotente). */
export async function ensureSearchIndexes(meili: MeiliSearch): Promise<void> {
  for (const name of Object.values(SEARCH_INDEXES)) {
    const created = await meili.createIndex(name, { primaryKey: 'id' }).catch(() => null);
    if (created !== null) await meili.tasks.waitForTask(created.taskUid);
    const task = await meili.index(name).updateSettings(SEARCH_INDEX_SETTINGS[name]);
    await meili.tasks.waitForTask(task.taskUid);
  }
}

async function peopleKeys(tx: Transaction, boardId: string): Promise<string[]> {
  const rows = await tx
    .select({ key: columnDefinitions.key })
    .from(columnDefinitions)
    .where(
      and(
        eq(columnDefinitions.boardId, boardId),
        eq(columnDefinitions.type, 'people'),
        isNull(columnDefinitions.deletedAt),
      ),
    );
  return rows.map((row) => row.key);
}

function assignees(values: Record<string, Record<string, unknown>>, keys: string[]): string[] {
  const ids = new Set<string>();
  for (const key of keys) {
    for (const list of [values[key]?.personIds, values[key]?.teamIds])
      if (Array.isArray(list)) list.forEach((id) => ids.add(String(id)));
  }
  return [...ids];
}

async function itemDocument(tx: Transaction, itemId: string): Promise<ItemSearchDocument | null> {
  const [row] = await tx
    .select({
      item: items,
      boardName: boards.name,
      workspaceId: boards.workspaceId,
      groupName: groups.name,
    })
    .from(items)
    .innerJoin(boards, eq(boards.id, items.boardId))
    .innerJoin(groups, eq(groups.id, items.groupId))
    .where(and(eq(items.id, itemId), isNull(items.deletedAt), isNull(boards.deletedAt)));
  if (row === undefined) return null;
  return {
    id: row.item.id,
    tenantId: row.item.tenantId,
    workspaceId: row.workspaceId,
    boardId: row.item.boardId,
    boardName: row.boardName,
    groupName: row.groupName,
    name: row.item.name,
    assigneeIds: assignees(row.item.values, await peopleKeys(tx, row.item.boardId)),
    archived: row.item.archivedAt !== null,
    updatedAt: row.item.updatedAt.getTime(),
  };
}

async function boardDocument(
  tx: Transaction,
  boardId: string,
): Promise<BoardSearchDocument | null> {
  const [row] = await tx
    .select()
    .from(boards)
    .where(and(eq(boards.id, boardId), isNull(boards.deletedAt)));
  if (row === undefined) return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    workspaceId: row.workspaceId,
    boardId: row.id,
    name: row.name,
    description: row.description ?? '',
    updatedAt: row.updatedAt.getTime(),
  };
}

async function updateDocument(
  tx: Transaction,
  updateId: string,
): Promise<UpdateSearchDocument | null> {
  const [row] = await tx
    .select({
      update: updates,
      itemName: items.name,
      itemValues: items.values,
      workspaceId: boards.workspaceId,
    })
    .from(updates)
    .innerJoin(items, eq(items.id, updates.itemId))
    .innerJoin(boards, eq(boards.id, updates.boardId))
    .where(and(eq(updates.id, updateId), isNull(updates.deletedAt), isNull(items.deletedAt)));
  if (row === undefined) return null;
  return {
    id: row.update.id,
    tenantId: row.update.tenantId,
    workspaceId: row.workspaceId,
    boardId: row.update.boardId,
    itemId: row.update.itemId,
    itemName: row.itemName,
    bodyText: row.update.bodyText,
    assigneeIds: assignees(row.itemValues, await peopleKeys(tx, row.update.boardId)),
    createdAt: row.update.createdAt.getTime(),
  };
}

type SearchDocument = ItemSearchDocument | BoardSearchDocument | UpdateSearchDocument;

function buildDocument(
  tx: Transaction,
  entity: 'item' | 'board' | 'update',
  id: string,
): Promise<SearchDocument | null> {
  if (entity === 'item') return itemDocument(tx, id);
  if (entity === 'board') return boardDocument(tx, id);
  return updateDocument(tx, id);
}

const ENTITY_INDEX: Record<'item' | 'board' | 'update', SearchIndexName> = {
  item: SEARCH_INDEXES.items,
  board: SEARCH_INDEXES.boards,
  update: SEARCH_INDEXES.updates,
};

/** Converte eventos de domínio em jobs de indexação. */
export function toIndexJob(raw: unknown): SearchIndexJob | null {
  const event = DomainEventJobSchema.safeParse(raw);
  if (!event.success) return SearchIndexJobSchema.parse(raw);
  const { type, tenantId, itemId, boardId, payload } = event.data;
  if (type.startsWith('item.') && itemId !== null)
    return {
      kind: 'entity',
      tenantId,
      entity: 'item',
      id: itemId,
      deleted: type === 'item.deleted',
    };
  if (type === 'board.updated' && boardId !== null)
    return { kind: 'entity', tenantId, entity: 'board', id: boardId, deleted: false };
  if (type === 'update.created' && typeof payload.updateId === 'string') {
    return { kind: 'entity', tenantId, entity: 'update', id: payload.updateId, deleted: false };
  }
  return null;
}

/** Indexação no Meilisearch (sem valores de colunas customizadas — ver ADR 0011/0027). */
export function searchIndexProcessor(deps: { database: DatabaseHandle; meili: MeiliSearch }) {
  const index = async (job: SearchIndexJob): Promise<{ indexed: number; deleted: number }> => {
    if (job.kind === 'reindex-tenant') return reindexTenant(job.tenantId);
    const target = deps.meili.index(ENTITY_INDEX[job.entity]);
    const document = job.deleted
      ? null
      : await withTenant(deps.database.db, { tenantId: job.tenantId }, (tx) =>
          buildDocument(tx, job.entity, job.id),
        );
    if (document === null) {
      await deps.meili.tasks.waitForTask((await target.deleteDocument(job.id)).taskUid);
      return { indexed: 0, deleted: 1 };
    }
    await deps.meili.tasks.waitForTask(
      (await target.addDocuments([document], { primaryKey: 'id' })).taskUid,
    );
    return { indexed: 1, deleted: 0 };
  };

  const reindexTenant = async (tenantId: string) => {
    let indexed = 0;
    for (const entity of ['board', 'item', 'update'] as const) {
      let after = '00000000-0000-0000-0000-000000000000';
      for (;;) {
        const documents = await withTenant(deps.database.db, { tenantId }, async (tx) => {
          const table = entity === 'board' ? boards : entity === 'item' ? items : updates;
          const ids = await tx
            .select({ id: table.id })
            .from(table)
            .where(and(gt(table.id, after), isNull(table.deletedAt)))
            .orderBy(table.id)
            .limit(BATCH);
          const built = await Promise.all(ids.map(({ id }) => buildDocument(tx, entity, id)));
          return {
            last: ids.at(-1)?.id,
            documents: built.filter((document): document is SearchDocument => document !== null),
          };
        });
        if (documents.documents.length > 0) {
          const task = await deps.meili
            .index(ENTITY_INDEX[entity])
            .addDocuments(documents.documents, { primaryKey: 'id' });
          await deps.meili.tasks.waitForTask(task.taskUid);
          indexed += documents.documents.length;
        }
        if (documents.last === undefined) break;
        after = documents.last;
      }
    }
    return { indexed, deleted: 0 };
  };

  return async (job: Job) => {
    const parsed = toIndexJob(job.data);
    return parsed === null ? { indexed: 0, deleted: 0 } : index(parsed);
  };
}
