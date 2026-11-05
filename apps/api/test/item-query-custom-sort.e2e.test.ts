import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  client,
  demoIds,
  resetRateLimits,
  startApi,
  USERS,
  type ApiClient,
  type ApiServer,
} from './helpers.js';

/**
 * Cobertura dedicada do caminho de ordenação/filtro por coluna customizada em `item-query.ts`
 * (ADR 0058): itens SEM valor na coluna (nenhuma linha em `item_field_index`) precisam continuar
 * aparecendo, sempre por último independente da direção, e a paginação por cursor precisa
 * atravessar corretamente a fronteira entre "tem valor" e "não tem valor" — exatamente o que
 * `buildProjectedSortQuery` (top-N em duas etapas) precisa preservar em relação ao `LEFT JOIN`
 * antigo. Também cobre filtro por coluna customizada (numérica) com itens sem valor.
 */
describe('Itens: ordenação e filtro por coluna customizada (Prompt 16 — performance)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let owner: string;
  let workspaceId: string;
  let boardId: string;
  let groupId: string;
  let numKey: string;
  let dateKey: string;
  let textKey: string;

  interface Item {
    id: string;
    values: Record<string, Record<string, unknown>>;
  }

  interface PagedIdsResponse {
    status: number;
    body: {
      data: { id: string }[];
      pageInfo: { nextCursor: string | null; hasNextPage: boolean };
    };
  }

  const createItem = async (values: Record<string, unknown> = {}) => {
    const response = await api.post<Item>(`/v1/boards/${boardId}/items`, {
      token: owner,
      body: { groupId, name: 'Item', values },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body;
  };

  const listIds = async (query: string): Promise<string[]> => {
    const response = await api.get<{ data: { id: string }[] }>(
      `/v1/boards/${boardId}/items?limit=50${query}`,
      { token: owner },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body.data.map((entry) => entry.id);
  };

  beforeAll(async () => {
    await resetRateLimits();
    server = await startApi();
    api = client(server.url);
    owner = await api.login(USERS.ana);
    const ids = await demoIds(api, owner);
    workspaceId = ids.workspaceId;
    const created = await api.post<{ id: string }>(`/v1/workspaces/${workspaceId}/boards`, {
      token: owner,
      body: { name: 'Ordenação customizada — testes', template: { kind: 'builtin', key: 'blank' } },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    boardId = created.body.id;
    const board = await api.get<{ groups: { id: string }[] }>(`/v1/boards/${boardId}`, {
      token: owner,
    });
    groupId = board.body.groups[0]?.id ?? '';
    expect(groupId).not.toBe('');

    const numColumn = await api.post<{ key: string }>(`/v1/boards/${boardId}/columns`, {
      token: owner,
      body: { type: 'number', title: 'UST' },
    });
    expect(numColumn.status, JSON.stringify(numColumn.body)).toBe(201);
    numKey = numColumn.body.key;

    const dateColumn = await api.post<{ key: string }>(`/v1/boards/${boardId}/columns`, {
      token: owner,
      body: { type: 'date', title: 'Prazo' },
    });
    expect(dateColumn.status, JSON.stringify(dateColumn.body)).toBe(201);
    dateKey = dateColumn.body.key;

    const textColumn = await api.post<{ key: string }>(`/v1/boards/${boardId}/columns`, {
      token: owner,
      body: { type: 'text', title: 'Observação' },
    });
    expect(textColumn.status, JSON.stringify(textColumn.body)).toBe(201);
    textKey = textColumn.body.key;
  });

  afterAll(async () => {
    await server.close();
  });

  it('ordena por coluna numérica customizada; itens sem valor ficam sempre por último', async () => {
    const withValue30 = await createItem({ [numKey]: { n: '30' } });
    const withValue10 = await createItem({ [numKey]: { n: '10' } });
    const withValue20 = await createItem({ [numKey]: { n: '20' } });
    const noValue1 = await createItem({});
    const noValue2 = await createItem({});

    const desc = await listIds(`&sort=${numKey}:desc`);
    const descRelevant = desc.filter((id) =>
      [withValue30.id, withValue20.id, withValue10.id, noValue1.id, noValue2.id].includes(id),
    );
    expect(descRelevant).toEqual([
      withValue30.id,
      withValue20.id,
      withValue10.id,
      noValue1.id,
      noValue2.id,
    ]);

    const asc = await listIds(`&sort=${numKey}:asc`);
    const ascRelevant = asc.filter((id) =>
      [withValue30.id, withValue20.id, withValue10.id, noValue1.id, noValue2.id].includes(id),
    );
    // Nulos sempre por último, mesmo em ordem ascendente (ADR 0005/0020, nullSafe()).
    expect(ascRelevant).toEqual([
      withValue10.id,
      withValue20.id,
      withValue30.id,
      noValue1.id,
      noValue2.id,
    ]);
  });

  it('ordena por coluna de data customizada; itens sem valor ficam sempre por último', async () => {
    const late = await createItem({ [dateKey]: { d: '2026-12-01' } });
    const early = await createItem({ [dateKey]: { d: '2026-01-10' } });
    const mid = await createItem({ [dateKey]: { d: '2026-06-15' } });
    const noValue = await createItem({});

    const asc = await listIds(`&sort=${dateKey}:asc`);
    const relevant = asc.filter((id) => [late.id, early.id, mid.id, noValue.id].includes(id));
    expect(relevant).toEqual([early.id, mid.id, late.id, noValue.id]);

    const desc = await listIds(`&sort=${dateKey}:desc`);
    const relevantDesc = desc.filter((id) => [late.id, early.id, mid.id, noValue.id].includes(id));
    expect(relevantDesc).toEqual([late.id, mid.id, early.id, noValue.id]);
  });

  it('ordena por coluna de texto customizada; itens sem valor ficam sempre por último', async () => {
    const banana = await createItem({ [textKey]: { text: 'banana' } });
    const abacaxi = await createItem({ [textKey]: { text: 'abacaxi' } });
    const cereja = await createItem({ [textKey]: { text: 'cereja' } });
    const noValue = await createItem({});

    const asc = await listIds(`&sort=${textKey}:asc`);
    const relevant = asc.filter((id) =>
      [banana.id, abacaxi.id, cereja.id, noValue.id].includes(id),
    );
    expect(relevant).toEqual([abacaxi.id, banana.id, cereja.id, noValue.id]);

    const desc = await listIds(`&sort=${textKey}:desc`);
    const relevantDesc = desc.filter((id) =>
      [banana.id, abacaxi.id, cereja.id, noValue.id].includes(id),
    );
    expect(relevantDesc).toEqual([cereja.id, banana.id, abacaxi.id, noValue.id]);
  });

  it('pagina por cursor atravessando a fronteira entre itens com e sem valor', async () => {
    // Board dedicado para isolar a contagem de itens relevantes à paginação (independe dos testes
    // anteriores, que já criaram outros itens no mesmo board).
    const created = await api.post<{ id: string }>(`/v1/workspaces/${workspaceId}/boards`, {
      token: owner,
      body: { name: 'Paginação customizada — testes', template: { kind: 'builtin', key: 'blank' } },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const pagedBoardId = created.body.id;
    const board = await api.get<{ groups: { id: string }[] }>(`/v1/boards/${pagedBoardId}`, {
      token: owner,
    });
    const pagedGroupId = board.body.groups[0]?.id ?? '';
    const column = await api.post<{ key: string }>(`/v1/boards/${pagedBoardId}/columns`, {
      token: owner,
      body: { type: 'number', title: 'UST' },
    });
    const key = column.body.key;

    const create = async (values: Record<string, unknown>) => {
      const response = await api.post<Item>(`/v1/boards/${pagedBoardId}/items`, {
        token: owner,
        body: { groupId: pagedGroupId, name: 'Item', values },
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      return response.body.id;
    };

    // 5 itens com valor (30, 20, 10, 10, 5 — inclui empate para exercer o desempate por id) e 3 sem
    // valor nenhum: com `limit=2`, a página que fecha o ramo "com valor" e abre o ramo "sem valor"
    // cai no meio de uma mesma chamada. Criados em sequência (não `Promise.all`): o desempate do
    // empate (10, 10) é por `id` ascendente, e UUIDv7 só garante essa ordem para criações
    // sequenciais, não concorrentes.
    const withValues: string[] = [];
    for (const n of [30, 20, 10, 10, 5]) withValues.push(await create({ [key]: { n: String(n) } }));
    const withoutValues: string[] = [];
    for (let index = 0; index < 3; index += 1) withoutValues.push(await create({}));

    const listPaged = async (sort: string, pageSize: number): Promise<string[]> => {
      const ids: string[] = [];
      let cursor: string | null = null;
      let hasNextPage = true;
      while (hasNextPage) {
        const qs = `limit=${String(pageSize)}&sort=${encodeURIComponent(sort)}${
          cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`
        }`;
        const response: PagedIdsResponse = await api.get<PagedIdsResponse['body']>(
          `/v1/boards/${pagedBoardId}/items?${qs}`,
          { token: owner },
        );
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        ids.push(...response.body.data.map((entry: { id: string }) => entry.id));
        hasNextPage = response.body.pageInfo.hasNextPage;
        cursor = response.body.pageInfo.nextCursor;
        if (hasNextPage) expect(cursor).not.toBeNull();
      }
      return ids;
    };

    const singlePage = await api.get<{ data: { id: string }[] }>(
      `/v1/boards/${pagedBoardId}/items?limit=50&sort=${key}:desc`,
      { token: owner },
    );
    const expected = singlePage.body.data.map((entry) => entry.id);
    expect(expected).toEqual([...withValues, ...withoutValues]);

    const paged = await listPaged(`${key}:desc`, 2);
    expect(paged).toEqual(expected);

    const pagedAsc = await listPaged(`${key}:asc`, 3);
    const singleAsc = await api.get<{ data: { id: string }[] }>(
      `/v1/boards/${pagedBoardId}/items?limit=50&sort=${key}:asc`,
      { token: owner },
    );
    expect(pagedAsc).toEqual(singleAsc.body.data.map((entry) => entry.id));
  });

  it('filtra por coluna numérica customizada; itens sem valor ficam de fora', async () => {
    const created = await api.post<{ id: string }>(`/v1/workspaces/${workspaceId}/boards`, {
      token: owner,
      body: { name: 'Filtro customizado — testes', template: { kind: 'builtin', key: 'blank' } },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const filterBoardId = created.body.id;
    const board = await api.get<{ groups: { id: string }[] }>(`/v1/boards/${filterBoardId}`, {
      token: owner,
    });
    const filterGroupId = board.body.groups[0]?.id ?? '';
    const column = await api.post<{ key: string }>(`/v1/boards/${filterBoardId}/columns`, {
      token: owner,
      body: { type: 'number', title: 'UST' },
    });
    const key = column.body.key;
    const create = async (values: Record<string, unknown>) => {
      const response = await api.post<Item>(`/v1/boards/${filterBoardId}/items`, {
        token: owner,
        body: { groupId: filterGroupId, name: 'Item', values },
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      return response.body.id;
    };
    const high = await create({ [key]: { n: '100' } });
    const low = await create({ [key]: { n: '5' } });
    const noValue = await create({});

    const filter = { op: 'and', conditions: [{ field: key, operator: 'gt', value: 50 }] };
    const response = await api.get<{ data: { id: string }[] }>(
      `/v1/boards/${filterBoardId}/items?limit=50&filter=${encodeURIComponent(JSON.stringify(filter))}`,
      { token: owner },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const ids = response.body.data.map((entry) => entry.id);
    expect(ids).toContain(high);
    expect(ids).not.toContain(low);
    expect(ids).not.toContain(noValue);
  });
});
