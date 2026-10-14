import { DEMO_TENANT_ID } from '@cube-track/db';
import { SEARCH_INDEX_SETTINGS, SEARCH_INDEXES, type ItemSearchDocument } from '@cube-track/shared';
import { MeiliSearch } from 'meilisearch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';

import {
  client,
  demoIds,
  resetRateLimits,
  startApi,
  USERS,
  type ApiClient,
  type ApiServer,
} from './helpers.js';

describe('Busca global respeitando permissões', () => {
  let server: ApiServer;
  let api: ApiClient;
  let boardId: string;
  let workspaceId: string;
  let guestId: string;
  const meili = new MeiliSearch({ host: inject('meiliUrl'), apiKey: inject('meiliKey') });
  const marker = `zeta${Date.now()}`;

  beforeAll(async () => {
    await resetRateLimits();
    server = await startApi();
    api = client(server.url);
    const owner = await api.login(USERS.ana);
    ({ boardId, workspaceId } = await demoIds(api, owner));
    const members = await api.get<{ data: { userId: string; email: string }[] }>('/v1/members', {
      token: owner,
    });
    guestId = members.body.data.find((member) => member.email === USERS.patricia)?.userId ?? '';

    const settings = await meili
      .index(SEARCH_INDEXES.items)
      .updateSettings(SEARCH_INDEX_SETTINGS.items);
    await meili.tasks.waitForTask(settings.taskUid);
    const documents: ItemSearchDocument[] = [
      {
        id: '01920000-0000-7000-8000-0000000a0001',
        tenantId: DEMO_TENANT_ID,
        workspaceId,
        boardId,
        boardName: 'PMSP',
        groupName: 'G',
        name: `${marker} atribuído à fiscal`,
        assigneeIds: [guestId],
        archived: false,
        updatedAt: 1,
      },
      {
        id: '01920000-0000-7000-8000-0000000a0002',
        tenantId: DEMO_TENANT_ID,
        workspaceId,
        boardId,
        boardName: 'PMSP',
        groupName: 'G',
        name: `${marker} interno`,
        assigneeIds: [],
        archived: false,
        updatedAt: 2,
      },
      {
        id: '01920000-0000-7000-8000-0000000a0003',
        tenantId: '01920000-0000-7000-8000-0000000fffff',
        workspaceId,
        boardId: '01920000-0000-7000-8000-0000000ffffe',
        boardName: 'Outro',
        groupName: 'G',
        name: `${marker} de outro tenant`,
        assigneeIds: [],
        archived: false,
        updatedAt: 3,
      },
    ];
    const added = await meili
      .index(SEARCH_INDEXES.items)
      .addDocuments(documents, { primaryKey: 'id' });
    await meili.tasks.waitForTask(added.taskUid);
  });

  afterAll(async () => {
    await meili
      .index(SEARCH_INDEXES.items)
      .deleteDocuments([
        '01920000-0000-7000-8000-0000000a0001',
        '01920000-0000-7000-8000-0000000a0002',
        '01920000-0000-7000-8000-0000000a0003',
      ]);
    await server.close();
  });

  it('membro vê os itens do tenant; nunca de outro tenant', async () => {
    const token = await api.login(USERS.juliana);
    const result = await api.get<{ data: { id: string; title: string }[] }>(
      `/v1/search?q=${marker}&types=items`,
      { token },
    );
    expect(result.status).toBe(200);
    expect(result.body.data.map((hit) => hit.title).sort()).toEqual([
      `${marker} atribuído à fiscal`,
      `${marker} interno`,
    ]);
  });

  it('convidado só encontra itens em que é responsável', async () => {
    const token = await api.login(USERS.patricia);
    const result = await api.get<{ data: { title: string }[] }>(`/v1/search?q=${marker}`, {
      token,
    });
    expect(result.body.data.map((hit) => hit.title)).toEqual([`${marker} atribuído à fiscal`]);
  });

  it('GraphQL expõe a mesma busca', async () => {
    const token = await api.login(USERS.fernanda);
    const result = await api.graphql<{ search: { title: string }[] }>(
      'query($q: String!) { search(q: $q) { title type } }',
      { q: marker },
      token,
    );
    expect(result.body.data?.search).toHaveLength(2);
  });
});
