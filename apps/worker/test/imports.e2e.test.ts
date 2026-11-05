import { schema, type DatabaseHandle } from '@cube-track/db';
import { newId, trelloExportToTable, type ImportMapping } from '@cube-track/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';

import { importsProcessor } from '../src/processors/imports.js';
import { adminDb, appDb, demoContext, fakeJob, silentLogger, type DemoContext } from './helpers.js';

const { boards, groups, items, columnDefinitions, importJobs } = schema;

function stageKey(tenantId: string, importJobId: string): string {
  return `bgimport:${tenantId}:${importJobId}`;
}

let admin: DatabaseHandle;
let app: DatabaseHandle;
let redis: Redis;
let demo: DemoContext;
let anaId: string;

beforeAll(async () => {
  admin = adminDb();
  app = appDb();
  redis = new Redis(inject('redisUrl'), { maxRetriesPerRequest: null });
  demo = await demoContext(admin);
  const id = demo.users['ana.ribeiro'];
  if (id === undefined) throw new Error('Usuária demo "ana.ribeiro" ausente');
  anaId = id;
});

afterAll(async () => {
  redis.disconnect();
  await Promise.all([admin.close(), app.close()]);
});

/** Cria um board novo (vazio, sem grupos) com uma coluna `people` — para testar a importação sem a
 * bagagem de grupos/colunas pré-existentes do board PMSP. */
async function createTestBoard(name: string): Promise<{ boardId: string; membersColumnKey: string }> {
  const boardId = newId();
  await admin.db.insert(boards).values({
    id: boardId,
    tenantId: demo.tenantId,
    workspaceId: demo.workspaceId,
    name,
    kind: 'board',
    visibility: 'main',
    position: 'a0',
  });
  const membersColumnKey = 'c_membros';
  await admin.db.insert(columnDefinitions).values({
    tenantId: demo.tenantId,
    boardId,
    key: membersColumnKey,
    type: 'people',
    title: 'Membros',
    position: 'a0',
  });
  return { boardId, membersColumnKey };
}

async function createImportJob(input: {
  boardId: string;
  source: 'trello' | 'csv';
  fileName: string;
  mapping: ImportMapping;
  headers: string[];
  rows: string[][];
}): Promise<string> {
  const importJobId = newId();
  await redis.set(
    stageKey(demo.tenantId, importJobId),
    JSON.stringify({ headers: input.headers, rows: input.rows }),
    'EX',
    3_600,
  );
  await admin.db.insert(importJobs).values({
    id: importJobId,
    tenantId: demo.tenantId,
    boardId: input.boardId,
    userId: anaId,
    source: input.source,
    status: 'uploaded',
    fileName: input.fileName,
    mapping: input.mapping,
    totalRows: input.rows.length,
  });
  return importJobId;
}

describe('Processador de importação em background (Monday/Trello/Jira/Pipefy/CSV, ADR 0056)', () => {
  it('critério de aceite: importa um export do Trello preservando grupos (listas), nomes e responsáveis', async () => {
    const { boardId, membersColumnKey } = await createTestBoard('Import — Trello');
    const trelloExport = {
      lists: [
        { id: 'list1', name: 'A fazer' },
        { id: 'list2', name: 'Concluído' },
      ],
      members: [{ id: 'm1', fullName: 'Ana Paula Ribeiro' }],
      cards: [
        {
          idList: 'list1',
          name: 'Importar do Trello',
          desc: 'Card de teste',
          idMembers: ['m1'],
          labels: [],
        },
        { idList: 'list2', name: 'Já estava pronto', idMembers: [], labels: [] },
      ],
    };
    const table = trelloExportToTable(trelloExport);
    expect(table.headers).toEqual(['Group', 'Name', 'Description', 'Due', 'Members', 'Labels']);

    // Mapeamento equivalente ao que a prévia da API sugeriria e o usuário confirmaria em
    // `PATCH /v1/imports/:id/mapping`: Group → grupo, Name → nome, Members → coluna de pessoas.
    const mapping: ImportMapping = {
      0: { type: 'group' },
      1: { type: 'name' },
      2: { type: 'ignore' },
      3: { type: 'ignore' },
      4: { type: 'column', key: membersColumnKey },
      5: { type: 'ignore' },
    };
    const importJobId = await createImportJob({
      boardId,
      source: 'trello',
      fileName: 'board.json',
      mapping,
      headers: table.headers,
      rows: table.rows,
    });

    const processor = importsProcessor({ database: app, redis, logger: silentLogger });
    const result = await processor(
      fakeJob({ tenantId: demo.tenantId, importJobId, userId: anaId, boardId }),
    );
    expect(result.status).toBe('completed');

    const [job] = await admin.db.select().from(importJobs).where(eq(importJobs.id, importJobId));
    expect(job?.status).toBe('completed');
    expect(job?.createdCount).toBe(2);
    expect(job?.skippedCount).toBe(0);

    // Grupos preservados (listas → grupos).
    const createdGroups = await admin.db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(and(eq(groups.boardId, boardId), isNull(groups.deletedAt)));
    expect(createdGroups.map((g) => g.name).sort()).toEqual(['A fazer', 'Concluído']);

    // Nomes dos itens preservados.
    const createdItems = await admin.db
      .select()
      .from(items)
      .where(and(eq(items.boardId, boardId), isNull(items.deletedAt)));
    expect(createdItems.map((i) => i.name).sort()).toEqual(['Importar do Trello', 'Já estava pronto']);

    // Responsável (Members) mapeado e resolvido para o id real do usuário pelo nome.
    const cardWithMember = createdItems.find((i) => i.name === 'Importar do Trello');
    const membersValue = cardWithMember?.values[membersColumnKey] as
      | { personIds?: string[] }
      | undefined;
    expect(membersValue?.personIds).toContain(anaId);

    // Item sem membro não deve ter a coluna preenchida.
    const cardWithoutMember = createdItems.find((i) => i.name === 'Já estava pronto');
    expect(cardWithoutMember?.values[membersColumnKey]).toBeUndefined();

    // O job encenado no Redis é limpo após o processamento.
    const staged = await redis.get(stageKey(demo.tenantId, importJobId));
    expect(staged).toBeNull();
  });

  it('um job CSV com linhas ruins ainda termina `completed`, com `errorReport` populado (não falha o job inteiro)', async () => {
    const { boardId } = await createTestBoard('Import — CSV com erros');
    const headers = ['Nome', 'Grupo'];
    const rows = [
      ['Linha válida', 'Grupo A'],
      ['', 'Grupo A'], // sem nome — deve ser ignorada (skipped), não falhar o job.
      ['Outra linha válida', 'Grupo B'],
    ];
    const mapping: ImportMapping = { 0: { type: 'name' }, 1: { type: 'group' } };
    const importJobId = await createImportJob({ boardId, source: 'csv', fileName: 'tarefas.csv', mapping, headers, rows });

    const processor = importsProcessor({ database: app, redis, logger: silentLogger });
    const result = await processor(
      fakeJob({ tenantId: demo.tenantId, importJobId, userId: anaId, boardId }),
    );
    expect(result.status).toBe('completed');

    const [job] = await admin.db.select().from(importJobs).where(eq(importJobs.id, importJobId));
    expect(job?.status).toBe('completed');
    expect(job?.createdCount).toBe(2);
    expect(job?.skippedCount).toBe(1);
    expect(job?.errorReport?.length).toBe(1);
    expect(job?.errorReport?.[0]?.message).toContain('nome');
  });

  it('`status: failed` só quando o job inteiro não consegue começar (dados expirados no Redis)', async () => {
    const { boardId } = await createTestBoard('Import — dados expirados');
    const importJobId = newId();
    // Sem `redis.set` — simula a expiração do TTL da prévia antes do commit rodar.
    await admin.db.insert(importJobs).values({
      id: importJobId,
      tenantId: demo.tenantId,
      boardId,
      userId: anaId,
      source: 'csv',
      status: 'uploaded',
      fileName: 'expirado.csv',
      mapping: { 0: { type: 'name' } },
      totalRows: 1,
    });

    const processor = importsProcessor({ database: app, redis, logger: silentLogger });
    const result = await processor(
      fakeJob({ tenantId: demo.tenantId, importJobId, userId: anaId, boardId }),
    );
    expect(result.status).toBe('failed');

    const [job] = await admin.db.select().from(importJobs).where(eq(importJobs.id, importJobId));
    expect(job?.status).toBe('failed');
    expect(job?.errorReport?.length).toBe(1);
  });
});
