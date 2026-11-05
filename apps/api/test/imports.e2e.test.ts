import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { client, demoIds, startApi, USERS, type ApiClient, type ApiServer, type BoardDetailFixture } from './helpers.js';

interface ImportJob {
  id: string;
  boardId: string;
  source: string;
  status: 'uploaded' | 'processing' | 'completed' | 'failed';
  fileName: string;
  mapping: Record<string, { type: string; key?: string }>;
  totalRows: number;
  createdCount: number | null;
  skippedCount: number | null;
}
interface PreviewResult {
  importJobId: string;
  headers: string[];
  sample: string[][];
  totalRows: number;
  suggestedMapping: Record<string, { type: string; key?: string }>;
}

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

const CSV = 'Nome,Grupo\nTarefa 1,A fazer\nTarefa 2,A fazer\n';

describe('Importação em background (Monday/Trello/Jira/Pipefy/CSV, ADR 0056)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let owner: string;
  let other: string; // thiago — sem acesso ao board PMSP
  let boardId: string;
  let board: BoardDetailFixture;

  beforeAll(async () => {
    server = await startApi();
    api = client(server.url);
    owner = await api.login(USERS.ana);
    other = await api.login(USERS.thiago);
    ({ boardId, board } = await demoIds(api, owner));
  });

  afterAll(async () => {
    await server.close();
  });

  it('requer `item.create` no board para pré-visualizar um upload', async () => {
    const forbidden = await api.post<PreviewResult>(`/v1/boards/${boardId}/imports/preview`, {
      token: other,
      body: { source: 'csv', fileName: 'tarefas.csv', contentBase64: base64(CSV) },
    });
    expect(forbidden.status).toBe(403);
  });

  it('preview de CSV sugere mapeamento, encena as linhas e cria o job com status `uploaded`', async () => {
    const preview = await api.post<PreviewResult>(`/v1/boards/${boardId}/imports/preview`, {
      token: owner,
      body: { source: 'csv', fileName: 'tarefas.csv', contentBase64: base64(CSV) },
    });
    expect(preview.status).toBe(201);
    expect(preview.body.headers).toEqual(['Nome', 'Grupo']);
    expect(preview.body.totalRows).toBe(2);
    expect(preview.body.sample).toHaveLength(2);
    expect(Object.values(preview.body.suggestedMapping).some((entry) => entry.type === 'name')).toBe(true);
    expect(Object.values(preview.body.suggestedMapping).some((entry) => entry.type === 'group')).toBe(true);

    const status = await api.get<ImportJob>(`/v1/imports/${preview.body.importJobId}`, { token: owner });
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('uploaded');
    expect(status.body.source).toBe('csv');
    expect(status.body.fileName).toBe('tarefas.csv');
  });

  it('ajusta o mapeamento (PATCH), confirma (commit) e bloqueia novo ajuste/commit depois disso', async () => {
    const preview = await api.post<PreviewResult>(`/v1/boards/${boardId}/imports/preview`, {
      token: owner,
      body: { source: 'csv', fileName: 'tarefas2.csv', contentBase64: base64(CSV) },
    });
    const ownerColumn = board.columns.find((column) => column.type === 'people');
    const mapping: Record<string, { type: string; key?: string }> = {
      ...preview.body.suggestedMapping,
      ...(ownerColumn === undefined ? {} : { 1: { type: 'column', key: ownerColumn.key } }),
    };
    const patched = await api.patch<ImportJob>(`/v1/imports/${preview.body.importJobId}/mapping`, {
      token: owner,
      body: { mapping },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe('uploaded');

    const forbiddenPatch = await api.patch(`/v1/imports/${preview.body.importJobId}/mapping`, {
      token: other,
      body: { mapping },
    });
    expect(forbiddenPatch.status).toBe(404);

    const committed = await api.post<ImportJob>(`/v1/imports/${preview.body.importJobId}/commit`, { token: owner });
    expect(committed.status).toBe(200);
    expect(committed.body.status).toBe('processing');

    const secondCommit = await api.post(`/v1/imports/${preview.body.importJobId}/commit`, { token: owner });
    expect(secondCommit.status).toBe(409);
    const patchAfterCommit = await api.patch(`/v1/imports/${preview.body.importJobId}/mapping`, {
      token: owner,
      body: { mapping },
    });
    expect(patchAfterCommit.status).toBe(409);
  });

  it('aceita um export do Trello (JSON) na prévia, convertendo listas em grupos e cartões em linhas', async () => {
    const trello = {
      lists: [
        { id: 'list1', name: 'A fazer' },
        { id: 'list2', name: 'Concluído' },
      ],
      members: [{ id: 'm1', fullName: 'Ana Ribeiro' }],
      cards: [
        { idList: 'list1', name: 'Importar do Trello', desc: 'desc', idMembers: ['m1'], labels: [] },
        { idList: 'list2', name: 'Já feito', idMembers: [], labels: [] },
      ],
    };
    const preview = await api.post<PreviewResult>(`/v1/boards/${boardId}/imports/preview`, {
      token: owner,
      body: { source: 'trello', fileName: 'board.json', contentBase64: base64(JSON.stringify(trello)) },
    });
    expect(preview.status).toBe(201);
    expect(preview.body.headers).toEqual(['Group', 'Name', 'Description', 'Due', 'Members', 'Labels']);
    expect(preview.body.totalRows).toBe(2);
    expect(Object.values(preview.body.suggestedMapping).some((entry) => entry.type === 'group')).toBe(true);
    expect(Object.values(preview.body.suggestedMapping).some((entry) => entry.type === 'name')).toBe(true);
  });

  it('rejeita origem desconhecida e arquivo sem linhas de dados', async () => {
    const badSource = await api.post(`/v1/boards/${boardId}/imports/preview`, {
      token: owner,
      body: { source: 'not-a-real-source', fileName: 'x.csv', contentBase64: base64(CSV) },
    });
    expect(badSource.status).toBe(400);

    const empty = await api.post(`/v1/boards/${boardId}/imports/preview`, {
      token: owner,
      body: { source: 'csv', fileName: 'vazio.csv', contentBase64: base64('Nome,Grupo\n') },
    });
    expect(empty.status).toBe(422);
  });

  it('só quem iniciou a importação lê o job, a menos que tenha `item.create` no board', async () => {
    const preview = await api.post<PreviewResult>(`/v1/boards/${boardId}/imports/preview`, {
      token: owner,
      body: { source: 'csv', fileName: 'privado.csv', contentBase64: base64(CSV) },
    });
    const forbidden = await api.get(`/v1/imports/${preview.body.importJobId}`, { token: other });
    // `thiago` (viewer) enxerga o board (não é NotFound) mas não tem `item.create` — 403.
    expect(forbidden.status).toBe(403);
  });
});
