import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  client,
  demoIds,
  resetRateLimits,
  startApi,
  USERS,
  type ApiClient,
  type ApiServer,
  type BoardDetailFixture,
} from './helpers.js';

interface Item {
  id: string;
  name: string;
  groupId: string;
  parentItemId: string | null;
  values: Record<string, Record<string, unknown>>;
  fieldVersions: Record<string, number>;
  version: number;
  archivedAt: string | null;
  indicators?: { subitems: number; attachments: number; updates: number; unreadUpdates: number };
}

type Board = Omit<BoardDetailFixture, 'columns'> & {
  id: string;
  icon: string | null;
  settings: Record<string, unknown>;
  columns: (BoardDetailFixture['columns'][number] & {
    settings: Record<string, unknown>;
    requiredWhen: Record<string, unknown> | null;
  })[];
};

describe('Boards, colunas, grupos e itens (Prompt 5)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let owner: string;
  let viewer: string;
  let workspaceId: string;
  let boardId: string;
  let board: Board;

  const reload = async () => {
    board = (await api.get<Board>(`/v1/boards/${boardId}`, { token: owner })).body;
    return board;
  };
  const column = (key: string) => {
    const found = board.columns.find((entry) => entry.key === key);
    if (found === undefined) throw new Error(`coluna ${key}`);
    return found;
  };
  const label = (key: string, text: string) => {
    const found = column(key).labels.find((entry) => entry.label === text);
    if (found === undefined) throw new Error(`rótulo ${text}`);
    return found.id;
  };
  const group = (index = 0) => board.groups[index]?.id ?? '';
  const createItem = async (
    name: string,
    values: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ) => {
    const response = await api.post<Item>(`/v1/boards/${boardId}/items`, {
      token: owner,
      body: { groupId: group(), name, values, ...extra },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body;
  };
  const list = async (query = '') =>
    (
      await api.get<{ data: Item[] }>(`/v1/boards/${boardId}/items?limit=200${query}`, {
        token: owner,
      })
    ).body.data;

  beforeAll(async () => {
    await resetRateLimits();
    server = await startApi();
    api = client(server.url);
    owner = await api.login(USERS.ana);
    viewer = await api.login(USERS.thiago);
    workspaceId = (await demoIds(api, owner)).workspaceId;
    const created = await api.post<{ id: string }>(`/v1/workspaces/${workspaceId}/boards`, {
      token: owner,
      body: {
        name: 'OS — testes',
        icon: 'file-text',
        template: { kind: 'builtin', key: 'service_orders' },
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    boardId = created.body.id;
    await reload();
  });

  afterAll(async () => {
    await server.close();
  });

  it('cria board de template: grupos, colunas, regra condicional, coluna principal e templates listados', async () => {
    expect(board.icon).toBe('file-text');
    expect(board.groups.map((entry) => entry.name)).toEqual(['Em análise', 'Em andamento']);
    expect(board.settings.statusColumnKey).toBe('c_status');
    expect(column('c_sei').requiredWhen).toEqual({
      op: 'and',
      conditions: [{ field: 'c_os_emitida', operator: 'is', value: label('c_os_emitida', 'Sim') }],
    });
    const templates = await api.get<{ builtin: { key: string }[] }>('/v1/board-templates', {
      token: owner,
    });
    expect(templates.body.builtin.map((entry) => entry.key)).toEqual([
      'blank',
      'project',
      'requests',
      'service_orders',
    ]);
  });

  it('Gherkin: marcar "OS emitida = Sim" sem Processo SEI exige o preenchimento antes de salvar', async () => {
    const item = await createItem('OS 1', {
      c_os_emitida: { labelId: label('c_os_emitida', 'Não') },
    });
    const blocked = await api.patch<{ code: string; fields: { key: string; title: string }[] }>(
      `/v1/items/${item.id}`,
      {
        token: owner,
        body: { values: { c_os_emitida: { labelId: label('c_os_emitida', 'Sim') } } },
      },
    );
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('required_fields_missing');
    expect(blocked.body.fields).toEqual([{ key: 'c_sei', title: 'Processo SEI' }]);
    const saved = await api.patch<Item>(`/v1/items/${item.id}`, {
      token: owner,
      body: {
        values: {
          c_os_emitida: { labelId: label('c_os_emitida', 'Sim') },
          c_sei: { text: '6011.2026/0001234-5' },
        },
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.values.c_sei).toEqual({ text: '6011.2026/0001234-5' });
  });

  it('fórmula recalculada na escrita; erro de sintaxe recusado; ID automático com máscara', async () => {
    const item = await createItem('OS 2', { c_ust: { n: '10.5' }, c_valor_ust: { n: '120' } });
    expect(item.values.c_valor_os).toMatchObject({ n: '1260' });
    expect(String(item.values.c_id?.text)).toMatch(/^OS-\d{4}-\d{4}$/);
    const updated = await api.patch<Item>(`/v1/items/${item.id}`, {
      token: owner,
      body: { values: { c_ust: { n: '2' } } },
    });
    expect(updated.body.values.c_valor_os).toMatchObject({ n: '240' });
    const created = await api.post<{ key: string }>(`/v1/boards/${boardId}/columns`, {
      token: owner,
      body: { type: 'formula', title: 'Dobro', settings: { expression: '{Valor da OS} * 2' } },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.key).toBe('c_dobro');
    await reload();
    expect(column('c_dobro').settings.expression).toBe('{c_valor_os} * 2');
    const invalid = await api.post<{ code: string }>(`/v1/boards/${boardId}/columns`, {
      token: owner,
      body: { type: 'formula', title: 'Quebrada', settings: { expression: 'ROUND({c_ust}' } },
    });
    expect(invalid.status).toBe(422);
    expect(invalid.body.code).toBe('formula_syntax');
    const denied = await api.post(`/v1/boards/${boardId}/columns`, {
      token: viewer,
      body: { type: 'text', title: 'X' },
    });
    expect([403, 404]).toContain(denied.status);
  });

  it('colunas: rótulos substituídos limpam valores, opções, valor padrão, duplicar e excluir', async () => {
    const statusColumn = column('c_status');
    const doing = statusColumn.labels[1];
    if (doing === undefined) throw new Error('rótulo');
    const item = await createItem('OS 3', { c_status: { labelId: doing.id } });
    const replaced = await api.put(`/v1/boards/${boardId}/columns/${statusColumn.id}/labels`, {
      token: owner,
      body: {
        labels: statusColumn.labels
          .filter((entry) => entry.id !== doing.id)
          .map((entry) => ({
            id: entry.id,
            label: entry.label,
            color: '#579bfc',
            category: entry.category,
          }))
          .concat([{ label: 'Bloqueado', color: '#df2f4a', category: 'stuck' } as never]),
      },
    });
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
    expect(
      (await api.get<Item>(`/v1/items/${item.id}`, { token: owner })).body.values.c_status,
    ).toBeUndefined();

    const dropdown = await api.post<{ id: string; key: string }>(`/v1/boards/${boardId}/columns`, {
      token: owner,
      body: {
        type: 'dropdown',
        title: 'Órgão',
        settings: { multiple: true },
        options: [{ label: 'SMIT' }, { label: 'SEGES' }],
      },
    });
    await reload();
    const smit = column(dropdown.body.key).options[0]?.id ?? '';
    const defaulted = await api.patch(`/v1/boards/${boardId}/columns/${dropdown.body.id}`, {
      token: owner,
      body: { defaultValue: { optionIds: [smit] }, description: 'Órgão solicitante' },
    });
    expect(defaulted.status).toBe(200);
    const withDefault = await createItem('OS 4');
    expect(withDefault.values[dropdown.body.key]).toEqual({ optionIds: [smit] });

    const copy = await api.post<{ key: string }>(
      `/v1/boards/${boardId}/columns/${dropdown.body.id}/duplicate`,
      {
        token: owner,
        body: { includeValues: true },
      },
    );
    expect(copy.status).toBe(201);
    const copied = (await api.get<Item>(`/v1/items/${withDefault.id}`, { token: owner })).body
      .values[copy.body.key];
    expect((copied?.optionIds as string[] | undefined)?.length).toBe(1);
    expect((copied?.optionIds as string[])[0]).not.toBe(smit);

    const removed = await api.delete(`/v1/boards/${boardId}/columns/${dropdown.body.id}`, {
      token: owner,
    });
    expect(removed.status).toBe(204);
    await reload();
    expect(board.columns.some((entry) => entry.key === dropdown.body.key)).toBe(false);
  });

  it('grupos: criar, renomear, duplicar com itens, arquivar oculta itens, excluir e restaurar da lixeira', async () => {
    const created = await api.post<{ id: string }>(`/v1/boards/${boardId}/groups`, {
      token: owner,
      body: { name: 'Triagem', color: '#a25ddc', position: { beforeId: group(0) } },
    });
    expect(created.status).toBe(201);
    await reload();
    expect(board.groups[0]?.name).toBe('Triagem');
    const item = await api.post<Item>(`/v1/boards/${boardId}/items`, {
      token: owner,
      body: { groupId: created.body.id, name: 'Na triagem' },
    });
    const renamed = await api.patch<{ name: string }>(`/v1/groups/${created.body.id}`, {
      token: owner,
      body: { name: 'Triagem inicial' },
    });
    expect(renamed.body.name).toBe('Triagem inicial');
    const duplicated = await api.post<{ id: string }>(`/v1/groups/${created.body.id}/duplicate`, {
      token: owner,
      body: { includeItems: true },
    });
    expect((await list(`&groupId=${duplicated.body.id}`)).map((entry) => entry.name)).toEqual([
      'Na triagem',
    ]);

    await api.patch(`/v1/groups/${created.body.id}`, { token: owner, body: { archived: true } });
    expect((await list()).some((entry) => entry.id === item.body.id)).toBe(false);
    expect((await list('&archivedOnly=true')).some((entry) => entry.id === item.body.id)).toBe(
      true,
    );
    await api.patch(`/v1/groups/${created.body.id}`, { token: owner, body: { archived: false } });

    expect((await api.delete(`/v1/groups/${created.body.id}`, { token: owner })).status).toBe(204);
    const trash = await api.get<{ groups: { id: string }[] }>(`/v1/boards/${boardId}/trash`, {
      token: owner,
    });
    expect(trash.body.groups.map((entry) => entry.id)).toContain(created.body.id);
    expect((await api.post(`/v1/groups/${created.body.id}/restore`, { token: owner })).status).toBe(
      200,
    );
    expect((await list()).some((entry) => entry.id === item.body.id)).toBe(true);
  });

  it('itens: edição em massa atômica, duplicar com subitens, arquivar, lixeira e restaurar', async () => {
    const parent = await createItem('Com subitens');
    const child = await createItem('Subitem', {}, { parentItemId: parent.id });
    const other = await createItem('Outro');

    const atomic = await api.patch(`/v1/boards/${boardId}/items`, {
      token: owner,
      body: {
        items: [
          { id: parent.id, name: 'Renomeado' },
          { id: other.id, values: { c_ust: { n: 'abc' } } },
        ],
      },
    });
    expect(atomic.status).toBe(400);
    expect((await api.get<Item>(`/v1/items/${parent.id}`, { token: owner })).body.name).toBe(
      'Com subitens',
    );
    const bulk = await api.patch<{ data: Item[] }>(`/v1/boards/${boardId}/items`, {
      token: owner,
      body: {
        items: [parent, other].map((entry) => ({ id: entry.id, values: { c_ust: { n: '3' } } })),
      },
    });
    expect(bulk.status).toBe(200);
    expect(bulk.body.data.map((entry) => entry.values.c_ust)).toEqual([{ n: '3' }, { n: '3' }]);

    const withIndicators = (await list('&indicators=true')).find((entry) => entry.id === parent.id);
    expect(withIndicators?.indicators?.subitems).toBe(1);

    const duplicated = await api.post<{ items: Item[] }>(`/v1/boards/${boardId}/items/actions`, {
      token: owner,
      body: { action: 'duplicate', itemIds: [parent.id] },
    });
    const copyId = duplicated.body.items[0]?.id ?? '';
    const subitems = await list(`&parentItemId=${copyId}`);
    expect(subitems.map((entry) => entry.name)).toEqual(['Subitem']);

    await api.post(`/v1/boards/${boardId}/items/actions`, {
      token: owner,
      body: { action: 'archive', itemIds: [other.id] },
    });
    expect((await list()).some((entry) => entry.id === other.id)).toBe(false);
    await api.post(`/v1/boards/${boardId}/items/actions`, {
      token: owner,
      body: { action: 'unarchive', itemIds: [other.id] },
    });
    expect((await list()).some((entry) => entry.id === other.id)).toBe(true);

    await api.post(`/v1/boards/${boardId}/items/actions`, {
      token: owner,
      body: { action: 'delete', itemIds: [parent.id] },
    });
    const trash = await api.get<{ items: { id: string; expiresAt: string }[] }>(
      `/v1/boards/${boardId}/trash`,
      { token: owner },
    );
    expect(trash.body.items.map((entry) => entry.id)).toContain(parent.id);
    expect(trash.body.items.map((entry) => entry.id)).not.toContain(child.id);
    const restored = await api.post<{ items: Item[] }>(`/v1/boards/${boardId}/items/actions`, {
      token: owner,
      body: { action: 'restore', itemIds: [parent.id] },
    });
    expect(restored.body.items[0]?.id).toBe(parent.id);
    expect((await list(`&parentItemId=${parent.id}`)).map((entry) => entry.id)).toEqual([child.id]);
  });

  it('mover entre grupos e para outro board com mapeamento de colunas', async () => {
    const item = await createItem('Para mover', {
      c_ust: { n: '7' },
      c_status: { labelId: column('c_status').labels[0]?.id },
    });
    const sameBoard = await api.post<{ items: Item[] }>(`/v1/boards/${boardId}/items/actions`, {
      token: owner,
      body: { action: 'move', itemIds: [item.id], target: { boardId, groupId: group(1) } },
    });
    expect(sameBoard.body.items[0]?.groupId).toBe(group(1));

    const target = await api.post<{ id: string }>(`/v1/workspaces/${workspaceId}/boards`, {
      token: owner,
      body: { name: 'Destino', template: { kind: 'builtin', key: 'project' } },
    });
    const targetBoard = (await api.get<Board>(`/v1/boards/${target.body.id}`, { token: owner }))
      .body;
    const moved = await api.post<{ items: Item[] }>(`/v1/boards/${boardId}/items/actions`, {
      token: owner,
      body: {
        action: 'move',
        itemIds: [item.id],
        target: {
          boardId: target.body.id,
          groupId: targetBoard.groups[0]?.id,
          columnMapping: { c_ust: 'c_hours', c_status: 'c_status' },
        },
      },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const result = moved.body.items[0];
    expect(result?.values.c_hours).toEqual({ n: '7' });
    expect(result?.values.c_status).toEqual({
      labelId: targetBoard.columns.find((entry) => entry.key === 'c_status')?.labels[0]?.id,
    });
    expect(result?.values.c_progress).toMatchObject({ n: '0' });
    expect((await list()).some((entry) => entry.id === item.id)).toBe(false);
  });

  it('filtros: busca, "atrasados" e períodos dinâmicos', async () => {
    const late = await createItem(
      'Atrasada busca-xyz',
      {},
      { fields: { plannedEndDate: '2020-01-01' } },
    );
    const done = await createItem(
      'Concluída antiga',
      {
        c_status: {
          labelId: column('c_status').labels.find((entry) => entry.category === 'done')?.id,
        },
      },
      { fields: { plannedEndDate: '2020-01-01' } },
    );
    const filter = (value: unknown) => `&filter=${encodeURIComponent(JSON.stringify(value))}`;
    const overdue = await list(
      filter({ op: 'and', conditions: [{ field: 'c_due', operator: 'overdue' }] }),
    );
    expect(overdue.map((entry) => entry.id)).toContain(late.id);
    expect(overdue.map((entry) => entry.id)).not.toContain(done.id);
    const thisWeek = await list(
      filter({ op: 'and', conditions: [{ field: 'c_due', operator: 'is', value: 'this_week' }] }),
    );
    expect(thisWeek.map((entry) => entry.id)).not.toContain(late.id);
    expect((await list('&search=busca-xyz')).map((entry) => entry.id)).toEqual([late.id]);
  });

  it('dependências recusam ciclos; cronômetro soma tempo no servidor', async () => {
    const first = await createItem('Etapa 1');
    const second = await createItem('Etapa 2');
    expect(
      (
        await api.put(`/v1/items/${second.id}/dependencies`, {
          token: owner,
          body: { predecessors: [{ itemId: first.id }] },
        })
      ).status,
    ).toBe(204);
    const cycle = await api.put<{ code: string }>(`/v1/items/${first.id}/dependencies`, {
      token: owner,
      body: { predecessors: [{ itemId: second.id }] },
    });
    expect(cycle.status).toBe(422);
    expect(cycle.body.code).toBe('dependency_cycle');
    const deps = await api.get<{ data: { predecessorId: string; successorId: string }[] }>(
      `/v1/boards/${boardId}/dependencies`,
      { token: owner },
    );
    expect(deps.body.data).toContainEqual(
      expect.objectContaining({ predecessorId: first.id, successorId: second.id }),
    );

    const timerColumn = await api.post<{ key: string }>(`/v1/boards/${boardId}/columns`, {
      token: owner,
      body: { type: 'time_tracking', title: 'Tempo' },
    });
    const started = await api.post<Item>(`/v1/items/${first.id}/timer/${timerColumn.body.key}`, {
      token: owner,
      body: { action: 'start' },
    });
    expect(started.body.values[timerColumn.body.key]?.runningSince).toBeDefined();
    const stopped = await api.post<Item>(`/v1/items/${first.id}/timer/${timerColumn.body.key}`, {
      token: owner,
      body: { action: 'stop' },
    });
    expect(stopped.body.values[timerColumn.body.key]?.runningSince).toBeUndefined();
    expect(Number(stopped.body.values[timerColumn.body.key]?.n)).toBeGreaterThanOrEqual(0);
  });

  it('importa CSV com mapeamento (cria rótulos e grupos) e exporta CSV/Excel', async () => {
    const csv = [
      'Nome;Grupo;UST;Status;Observação',
      'Importada 1;Em análise;12,5;Em andamento;ok',
      'Importada 2;Novo grupo importado;3;Rótulo novo;',
      ';Em análise;1;;sem nome',
    ].join('\r\n');
    const preview = await api.post<{
      importId: string;
      headers: string[];
      totalRows: number;
      suggestedMapping: Record<string, string | null>;
    }>(`/v1/boards/${boardId}/imports`, {
      token: owner,
      body: { fileName: 'planilha.csv', contentBase64: Buffer.from(csv).toString('base64') },
    });
    expect(preview.status, JSON.stringify(preview.body)).toBe(201);
    expect(preview.body.totalRows).toBe(3);
    expect(preview.body.suggestedMapping).toEqual({
      '0': 'name',
      '1': 'group',
      '2': 'column:c_ust',
      '3': 'column:c_status',
      '4': null,
    });
    const committed = await api.post<{
      created: number;
      skipped: number;
      errors: { row: number }[];
    }>(`/v1/boards/${boardId}/imports/${preview.body.importId}/commit`, {
      token: owner,
      body: { mapping: preview.body.suggestedMapping, groupId: group(0), createMissing: true },
    });
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    expect(committed.body).toMatchObject({ created: 2, skipped: 1 });
    expect(committed.body.errors[0]?.row).toBe(4);
    await reload();
    expect(board.groups.map((entry) => entry.name)).toContain('Novo grupo importado');
    expect(column('c_status').labels.map((entry) => entry.label)).toContain('Rótulo novo');
    const imported = (await list('&search=Importada 1'.replace(' ', '%20')))[0];
    expect(imported?.values.c_ust).toEqual({ n: '12.5' });

    const response = await fetch(
      `${server.url}/v1/boards/${boardId}/export?format=csv&search=Importada`,
      {
        headers: { authorization: `Bearer ${owner}` },
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('.csv');
    const text = await response.text();
    expect(text).toContain('Importada 1;Em análise');
    expect(text).toContain('12,50 UST');
    const xlsx = await fetch(`${server.url}/v1/boards/${boardId}/export?format=xlsx`, {
      headers: { authorization: `Bearer ${owner}` },
    });
    expect(xlsx.headers.get('content-type')).toContain('spreadsheetml');
    expect((await xlsx.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });
});
