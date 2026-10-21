import { createHmac } from 'node:crypto';

import { schema } from '@cube-track/db';
import { encodeReplyPayload, mentionAttrs } from '@cube-track/shared';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  adminDb,
  client,
  demoIds,
  resetRateLimits,
  startApi,
  USERS,
  type ApiClient,
  type ApiServer,
} from './helpers.js';

const { users, mentions, outboxEvents } = schema;

const JWT_SECRET = 'test-secret-0123456789-0123456789-abcdef';
const MAIL_REPLY_DOMAIN = 'reply.cubetrack.test';
const WEBHOOK_SECRET = 'test-inbound-email-webhook-secret';

/** Mesmo esquema de `ReplyTokenService`/`reply-address.ts` (ADR 0048), só para montar o endereço no teste. */
function replyAddress(payload: { itemId: string; userId: string; updateId: string | null }): string {
  const { data, encoded } = encodeReplyPayload(payload);
  const signature = createHmac('sha256', JWT_SECRET).update(`email-reply:${data}`).digest('hex').slice(0, 16);
  return `reply+${encoded}.${signature}@${MAIL_REPLY_DOMAIN}`;
}

function doc(text: string, mention?: { id: string; label: string }): Record<string, unknown> {
  const content: Record<string, unknown>[] = [{ type: 'text', text }];
  if (mention !== undefined) {
    content.push({ type: 'text', text: ' ' });
    content.push({ type: 'mention', attrs: mentionAttrs.user(mention.id, mention.label) });
  }
  return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

describe('Painel do item: atualizações, atividade, checklists, dependências, seguir e aprovações', () => {
  let server: ApiServer;
  let api: ApiClient;
  let owner: string;
  let boardId: string;
  let itemId: string;
  let itemId2: string;
  let anaId: string;
  let carlosId: string;
  const db = adminDb();

  beforeAll(async () => {
    await resetRateLimits();
    server = await startApi();
    api = client(server.url);
    owner = await api.login(USERS.ana);
    ({ boardId } = await demoIds(api, owner));
    const items = await api.get<{ data: { id: string }[] }>(`/v1/boards/${boardId}/items?limit=2`, {
      token: owner,
    });
    itemId = items.body.data[0]?.id ?? '';
    itemId2 = items.body.data[1]?.id ?? '';
    const [ana] = await db.db.select({ id: users.id }).from(users).where(eq(users.email, USERS.ana));
    const [carlos] = await db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, USERS.carlos));
    anaId = ana?.id ?? '';
    carlosId = carlos?.id ?? '';
  });

  afterAll(async () => {
    await db.close();
    await server.close();
  });

  it('posta, edita (com histórico), fixa e exclui uma atualização; uma @menção notifica em tempo real', async () => {
    const created = await api.post<{ id: string; bodyText: string; isPinned: boolean }>(
      `/v1/items/${itemId}/updates`,
      { token: owner, body: { body: doc('Pode revisar?', { id: carlosId, label: 'Carlos' }) } },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.bodyText).toContain('@Carlos');
    const updateId = created.body.id;

    // A entrega da notificação (in-app + e-mail) é assíncrona, feita pelo worker a partir do evento
    // `update.created` (testado isoladamente em apps/worker); aqui confirmamos que a API gravou a
    // @menção e o evento corretamente — o gatilho que o worker consome.
    const [mentionRow] = await db.db
      .select()
      .from(mentions)
      .where(and(eq(mentions.sourceType, 'update'), eq(mentions.sourceId, updateId)));
    expect(mentionRow).toMatchObject({ targetType: 'user', targetId: carlosId, itemId });
    const [outboxRow] = await db.db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.eventType, 'update.created'), eq(outboxEvents.aggregateId, updateId)));
    expect(outboxRow?.payload).toMatchObject({ updateId, itemId, authorId: anaId });

    const edited = await api.patch<{ bodyText: string; editCount: number }>(`/v1/updates/${updateId}`, {
      token: owner,
      body: { body: doc('Pode revisar e aprovar?') },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.editCount).toBe(1);

    const pinned = await api.post<{ isPinned: boolean }>(`/v1/updates/${updateId}/pin`, {
      token: owner,
      body: { pinned: true },
    });
    expect(pinned.body.isPinned).toBe(true);

    const feed = await api.get<{ pinned: { id: string }[]; data: { id: string }[] }>(
      `/v1/items/${itemId}/updates`,
      { token: owner },
    );
    expect(feed.body.pinned.map((entry) => entry.id)).toContain(updateId);

    // Thiago (papel "viewer" do tenant) herda `board_viewer` no board principal: comenta mas não
    // tem `item.update`, então não pode moderar (editar/excluir) a atualização de outra pessoa.
    const thiagoToken = await api.login(USERS.thiago);
    const asThiago = await api.delete(`/v1/updates/${updateId}`, { token: thiagoToken });
    expect(asThiago.status).toBe(403);

    const deleted = await api.delete(`/v1/updates/${updateId}`, { token: owner });
    expect(deleted.status).toBe(204);
  });

  it('responde a uma atualização e reage com emoji', async () => {
    const update = await api.post<{ id: string }>(`/v1/items/${itemId}/updates`, {
      token: owner,
      body: { body: doc('Alguém pode confirmar o prazo?') },
    });
    const reply = await api.post<{ id: string; bodyText: string }>(
      `/v1/updates/${update.body.id}/replies`,
      { token: owner, body: { body: doc('Confirmado para sexta.') } },
    );
    expect(reply.status).toBe(201);
    const replies = await api.get<{ data: { id: string }[] }>(`/v1/updates/${update.body.id}/replies`, {
      token: owner,
    });
    expect(replies.body.data).toHaveLength(1);

    const reacted = await api.post<{ data: { emoji: string; count: number; reactedByMe: boolean }[] }>(
      `/v1/updates/${update.body.id}/reactions`,
      { token: owner, body: { emoji: '👍' } },
    );
    expect(reacted.body.data).toEqual([{ emoji: '👍', count: 1, reactedByMe: true }]);
    const toggled = await api.post<{ data: unknown[] }>(`/v1/updates/${update.body.id}/reactions`, {
      token: owner,
      body: { emoji: '👍' },
    });
    expect(toggled.body.data).toEqual([]);
  });

  it('registra o log de atividade de uma mudança de campo e permite filtrar por período/autor', async () => {
    const before = new Date().toISOString();
    const newName = `Atividade — renomeado ${Date.now()}`;
    const patched = await api.patch(`/v1/items/${itemId}`, { token: owner, body: { name: newName } });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    const activity = await api.get<{ data: { action: string; columnKey: string | null }[] }>(
      `/v1/items/${itemId}/activity`,
      { token: owner },
    );
    expect(activity.status).toBe(200);
    expect(activity.body.data.some((entry) => entry.action === 'item.renamed' && entry.columnKey === 'name')).toBe(
      true,
    );

    const filtered = await api.get<{ data: unknown[] }>(
      `/v1/items/${itemId}/activity?from=${encodeURIComponent(before)}&columnKey=name`,
      { token: owner },
    );
    expect(filtered.body.data.length).toBeGreaterThan(0);

    const futureOnly = await api.get<{ data: unknown[] }>(
      `/v1/items/${itemId}/activity?from=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`,
      { token: owner },
    );
    expect(futureOnly.body.data).toEqual([]);

    const actors = await api.get<{ data: { id: string }[] }>(`/v1/items/${itemId}/activity/actors`, {
      token: owner,
    });
    expect(actors.body.data.some((actor) => actor.id === anaId)).toBe(true);
  });

  it('checklist: cria, adiciona itens, marca como feito (progresso) e exclui', async () => {
    const checklist = await api.post<{ id: string; progress: { done: number; total: number } }>(
      `/v1/items/${itemId}/checklists`,
      { token: owner, body: { title: 'Antes de concluir' } },
    );
    expect(checklist.status).toBe(201);
    const checklistId = checklist.body.id;

    const item1 = await api.post<{ id: string }>(`/v1/checklists/${checklistId}/items`, {
      token: owner,
      body: { content: 'Revisar escopo' },
    });
    const item2 = await api.post<{ id: string }>(`/v1/checklists/${checklistId}/items`, {
      token: owner,
      body: { content: 'Validar com o cliente' },
    });
    expect(item1.status).toBe(201);

    await api.patch(`/v1/checklist-items/${item1.body.id}`, { token: owner, body: { isDone: true } });

    const list = await api.get<{ data: { id: string; progress: { done: number; total: number } }[] }>(
      `/v1/items/${itemId}/checklists`,
      { token: owner },
    );
    const found = list.body.data.find((entry) => entry.id === checklistId);
    expect(found?.progress).toEqual({ done: 1, total: 2 });

    await api.delete(`/v1/checklist-items/${item2.body.id}`, { token: owner });
    await api.delete(`/v1/checklists/${checklistId}`, { token: owner });
    const after = await api.get<{ data: { id: string }[] }>(`/v1/items/${itemId}/checklists`, {
      token: owner,
    });
    expect(after.body.data.some((entry) => entry.id === checklistId)).toBe(false);
  });

  // Dependências já tinham API própria desde o Prompt 5 (coluna de dependência, com detecção de
  // ciclo no grafo do board inteiro) — o painel do item reaproveita `GET boards/:id/dependencies`
  // e `PUT items/:id/dependencies` (testados em board-content.e2e.test.ts) via `DependencyEditor`.
  it('painel do item reaproveita a API de dependências existente (Prompt 5)', async () => {
    const set = await api.put(`/v1/items/${itemId}/dependencies`, {
      token: owner,
      body: { predecessors: [{ itemId: itemId2, type: 'FS', lagDays: 0 }] },
    });
    expect(set.status, JSON.stringify(set.body)).toBe(204);

    const list = await api.get<{ data: { predecessorId: string; successorId: string }[] }>(
      `/v1/boards/${boardId}/dependencies`,
      { token: owner },
    );
    expect(list.body.data).toContainEqual(
      expect.objectContaining({ predecessorId: itemId2, successorId: itemId }),
    );

    const cleared = await api.put(`/v1/items/${itemId}/dependencies`, {
      token: owner,
      body: { predecessors: [] },
    });
    expect(cleared.status).toBe(204);
  });

  it('seguir: alterna e lista seguidores do item', async () => {
    const initial = await api.get<{ following: boolean }>(`/v1/items/${itemId}/follow`, { token: owner });
    expect(initial.body.following).toBe(false);
    await api.post(`/v1/items/${itemId}/follow`, { token: owner, body: { following: true } });
    const after = await api.get<{ following: boolean; followers: { id: string }[] }>(
      `/v1/items/${itemId}/follow`,
      { token: owner },
    );
    expect(after.body.following).toBe(true);
    expect(after.body.followers.some((follower) => follower.id === anaId)).toBe(true);
    await api.post(`/v1/items/${itemId}/follow`, { token: owner, body: { following: false } });
  });

  it('aprovações: modo "qualquer um" resolve na primeira aprovação; só o aprovador decide', async () => {
    const carlosToken = await api.login(USERS.carlos);
    const requested = await api.post<{ id: string; status: string }>(`/v1/items/${itemId}/approvals`, {
      token: owner,
      body: { approverIds: [carlosId], mode: 'any', note: 'Pode aprovar?' },
    });
    expect(requested.status).toBe(201);
    expect(requested.body.status).toBe('pending');

    const deniedDecider = await api.post(`/v1/approvals/${requested.body.id}/decide`, {
      token: owner,
      body: { decision: 'approved' },
    });
    expect(deniedDecider.status).toBe(403);

    const decided = await api.post<{ status: string }>(`/v1/approvals/${requested.body.id}/decide`, {
      token: carlosToken,
      body: { decision: 'approved', comment: 'Pode seguir.' },
    });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe('approved');

    const list = await api.get<{ data: { id: string; status: string }[] }>(
      `/v1/items/${itemId}/approvals`,
      { token: owner },
    );
    expect(list.body.data.find((entry) => entry.id === requested.body.id)?.status).toBe('approved');
  });

  it('aprovações: modo "todos" rejeita assim que um aprovador rejeita', async () => {
    const carlosToken = await api.login(USERS.carlos);
    const requested = await api.post<{ id: string }>(`/v1/items/${itemId}/approvals`, {
      token: owner,
      body: { approverIds: [carlosId, anaId], mode: 'all' },
    });
    await api.post(`/v1/approvals/${requested.body.id}/decide`, {
      token: carlosToken,
      body: { decision: 'rejected' },
    });
    const list = await api.get<{ data: { id: string; status: string }[] }>(
      `/v1/items/${itemId}/approvals`,
      { token: owner },
    );
    expect(list.body.data.find((entry) => entry.id === requested.body.id)?.status).toBe('rejected');
  });

  it('aprovações: cancelar um pedido pendente', async () => {
    const requested = await api.post<{ id: string }>(`/v1/items/${itemId}/approvals`, {
      token: owner,
      body: { approverIds: [carlosId], mode: 'any' },
    });
    const cancelled = await api.post(`/v1/approvals/${requested.body.id}/cancel`, { token: owner });
    expect(cancelled.status).toBe(204);
    const cancelAgain = await api.post(`/v1/approvals/${requested.body.id}/cancel`, { token: owner });
    expect(cancelAgain.status).toBe(400);
  });

  describe('webhook de e-mail recebido', () => {
    it('exige o segredo do webhook', async () => {
      const response = await api.post('/v1/email/inbound', {
        body: { to: ['reply+x.y@reply.cubetrack.test'], text: 'oi' },
      });
      expect(response.status).toBe(401);
    });

    it('cria uma atualização nova a partir de um endereço de resposta sem updateId', async () => {
      const address = replyAddress({ itemId, userId: anaId, updateId: null });
      const response = await api.post<{ accepted: boolean; kind?: string }>('/v1/email/inbound', {
        headers: { 'x-webhook-secret': WEBHOOK_SECRET },
        body: { to: [`"Item" <${address}>`], text: 'Segue o retorno por e-mail.\n\nOn Mon wrote:\n> citação' },
      });
      expect(response.body).toEqual({ accepted: true, kind: 'update' });
      const [created] = await db.db
        .select()
        .from(schema.updates)
        .where(eq(schema.updates.itemId, itemId))
        .orderBy(desc(schema.updates.createdAt))
        .limit(1);
      expect(created?.source).toBe('email');
      expect(created?.bodyText).toBe('Segue o retorno por e-mail.');
      expect(created?.authorId).toBe(anaId);
    });

    it('cria uma resposta quando o endereço referencia uma atualização específica', async () => {
      const update = await api.post<{ id: string }>(`/v1/items/${itemId}/updates`, {
        token: owner,
        body: { body: doc('Preciso de retorno por e-mail também.') },
      });
      const address = replyAddress({ itemId, userId: carlosId, updateId: update.body.id });
      const response = await api.post<{ accepted: boolean; kind?: string }>('/v1/email/inbound', {
        headers: { 'x-webhook-secret': WEBHOOK_SECRET },
        body: { to: [address], text: 'Respondendo pelo e-mail.' },
      });
      expect(response.body).toEqual({ accepted: true, kind: 'reply' });
      const replies = await api.get<{ data: { bodyText: string; source: string; authorId: string }[] }>(
        `/v1/updates/${update.body.id}/replies`,
        { token: owner },
      );
      const reply = replies.body.data.find((entry) => entry.bodyText === 'Respondendo pelo e-mail.');
      expect(reply).toMatchObject({ source: 'email', authorId: carlosId });
    });

    it('rejeita endereço não reconhecido e corpo vazio após remover a citação', async () => {
      const unrecognized = await api.post<{ accepted: boolean; reason?: string }>('/v1/email/inbound', {
        headers: { 'x-webhook-secret': WEBHOOK_SECRET },
        body: { to: ['naoe@outrodominio.com'], text: 'qualquer coisa' },
      });
      expect(unrecognized.body).toEqual({ accepted: false, reason: 'address_not_recognized' });

      const address = replyAddress({ itemId, userId: anaId, updateId: null });
      const empty = await api.post<{ accepted: boolean; reason?: string }>('/v1/email/inbound', {
        headers: { 'x-webhook-secret': WEBHOOK_SECRET },
        body: { to: [address], text: 'On Mon wrote:\n> só citação' },
      });
      expect(empty.body).toEqual({ accepted: false, reason: 'empty_body' });
    });
  });
});
