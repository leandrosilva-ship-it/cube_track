import type { RealtimeEvent } from '@cube-track/shared';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  client,
  demoIds,
  resetRateLimits,
  startApi,
  USERS,
  waitFor,
  type ApiClient,
  type ApiServer,
} from './helpers.js';

interface Connected {
  socket: Socket;
  events: RealtimeEvent[];
}

async function connect(url: string, token: string): Promise<Connected> {
  const socket = io(url, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  const events: RealtimeEvent[] = [];
  socket.on('event', (event: RealtimeEvent) => events.push(event));
  await new Promise<void>((resolve, reject) => {
    socket.once('ready', () => {
      resolve();
    });
    socket.once('auth_error', (error: { code: string }) => {
      reject(new Error(error.code));
    });
    socket.once('connect_error', reject);
  });
  return { socket, events };
}

function emit<T = Record<string, unknown>>(
  socket: Socket,
  event: string,
  payload: unknown,
): Promise<T> {
  return socket.timeout(5_000).emitWithAck(event, payload) as Promise<T>;
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN
  );
};

describe('Tempo real (Socket.IO)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let owner: string;
  let manager: string;
  let editor: string;
  let guest: string;
  let boardId: string;
  let itemId: string;
  let tipoColumnId: string;
  let tipoLabels: string[];
  let statusLabels: string[];
  const sockets: Socket[] = [];

  const open = async (token: string) => {
    const connected = await connect(server.url, token);
    sockets.push(connected.socket);
    return connected;
  };

  beforeAll(async () => {
    await resetRateLimits();
    server = await startApi();
    api = client(server.url);
    owner = await api.login(USERS.ana);
    manager = await api.login(USERS.fernanda);
    editor = await api.login(USERS.juliana);
    guest = await api.login(USERS.patricia);
    const ids = await demoIds(api, owner);
    boardId = ids.boardId;
    const tipo = ids.board.columns.find((column) => column.key === 'c_tipo');
    tipoColumnId = tipo?.id ?? '';
    tipoLabels = tipo?.labels.map((label) => label.id) ?? [];
    // Rótulos não concluídos: "Concluído" exige "Término realizado" (obrigatória condicional).
    statusLabels =
      ids.board.columns
        .find((column) => column.key === 'c_status')
        ?.labels.filter((label) => label.category !== 'done')
        .map((label) => label.id) ?? [];
    const items = await api.get<{ data: { id: string }[] }>(
      `/v1/boards/${boardId}/items?limit=1&sort=name:desc`,
      { token: owner },
    );
    itemId = items.body.data[0]?.id ?? '';
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await api.patch(`/v1/boards/${boardId}/columns/${tipoColumnId}`, {
      token: owner,
      body: { permissions: {} },
    });
    await server.close();
  });

  it('rejeita conexão sem token válido', async () => {
    await expect(connect(server.url, 'token-invalido')).rejects.toThrow('token_invalid');
  });

  it('propaga a alteração de um item para outro cliente em < 300 ms (p95)', async () => {
    const a = await open(manager);
    const b = await open(editor);
    expect(
      (await emit<{ ok: boolean }>(a.socket, 'subscribe', { room: 'board', id: boardId })).ok,
    ).toBe(true);
    expect(
      (await emit<{ ok: boolean }>(b.socket, 'subscribe', { room: 'board', id: boardId })).ok,
    ).toBe(true);
    const latencies: number[] = [];
    for (let round = 0; round < 15; round += 1) {
      const label = statusLabels[round % statusLabels.length];
      const mutationId = `rt-${round}-${Date.now()}`;
      const started = performance.now();
      const response = await api.patch(`/v1/items/${itemId}`, {
        token: manager,
        body: { values: { c_status: { labelId: label } } },
        headers: { 'x-client-mutation-id': mutationId },
      });
      expect(response.status).toBe(200);
      const event = await waitFor(
        () => b.events.find((entry) => entry.clientMutationId === mutationId),
        2_000,
      );
      latencies.push(performance.now() - started);
      expect(event.type).toBe('item.updated');
      expect(event.scope.itemId).toBe(itemId);
      expect(typeof event.seq).toBe('number');
    }
    const p95 = percentile(latencies, 95);
    console.info(
      `Propagação realtime (REST → outro cliente): p50=${percentile(latencies, 50).toFixed(1)}ms p95=${p95.toFixed(1)}ms`,
    );
    expect(p95).toBeLessThan(300);
    // O autor também recebe (com o mesmo clientMutationId, para deduplicar a atualização otimista).
    expect(a.events.some((entry) => entry.clientMutationId?.startsWith('rt-0-') === true)).toBe(
      true,
    );
  });

  it('remove valores de colunas sem permissão no fan-out WebSocket', async () => {
    const members = await api.get<{ data: { userId: string; email: string }[] }>('/v1/members', {
      token: owner,
    });
    const anaId = members.body.data.find((member) => member.email === USERS.ana)?.userId;
    await api.patch(`/v1/boards/${boardId}/columns/${tipoColumnId}`, {
      token: owner,
      body: { permissions: { viewers: { userIds: [anaId] } } },
    });
    const privileged = await open(owner);
    const restricted = await open(editor);
    await emit(privileged.socket, 'subscribe', { room: 'board', id: boardId });
    await emit(restricted.socket, 'subscribe', { room: 'board', id: boardId });
    const mutationId = `hidden-${Date.now()}`;
    await api.patch(`/v1/items/${itemId}`, {
      token: owner,
      body: {
        values: { c_tipo: { labelId: tipoLabels[1] }, c_status: { labelId: statusLabels[0] } },
      },
      headers: { 'x-client-mutation-id': mutationId },
    });
    const full = await waitFor(() =>
      privileged.events.find((entry) => entry.clientMutationId === mutationId),
    );
    const partial = await waitFor(() =>
      restricted.events.find((entry) => entry.clientMutationId === mutationId),
    );
    const fields = (event: RealtimeEvent) =>
      (event.payload as { changes: { field: string }[] }).changes
        .map((change) => change.field)
        .sort();
    expect(fields(full)).toEqual(['c_status', 'c_tipo']);
    expect(fields(partial)).toEqual(['c_status']);
    expect(JSON.stringify(partial)).not.toContain(tipoLabels[1] ?? 'x');
  });

  it('convidado recebe apenas o avanço de sequência para itens não atribuídos', async () => {
    const g = await open(guest);
    expect(
      (await emit<{ ok: boolean }>(g.socket, 'subscribe', { room: 'board', id: boardId })).ok,
    ).toBe(true);
    const mutationId = `guest-${Date.now()}`;
    await api.patch(`/v1/items/${itemId}`, {
      token: manager,
      body: { name: `Renomeado ${Date.now()}` },
      headers: { 'x-client-mutation-id': mutationId },
    });
    const skipped = await waitFor(() =>
      g.events.find((entry) => entry.type === 'sequence.skipped'),
    );
    expect(skipped.payload).toEqual({});
    expect(skipped.clientMutationId).toBeNull();
    expect(g.events.some((entry) => entry.type === 'item.updated')).toBe(false);
  });

  it('presença: entrada, atualização de estado e saída', async () => {
    const a = await open(manager);
    const b = await open(editor);
    await emit(a.socket, 'subscribe', { room: 'board', id: boardId });
    await emit(b.socket, 'subscribe', { room: 'board', id: boardId });
    expect(
      (
        await emit<{ ok: boolean }>(b.socket, 'presence.heartbeat', {
          room: 'board',
          id: boardId,
          state: {},
        })
      ).ok,
    ).toBe(true);
    const joined = await waitFor(() => a.events.find((entry) => entry.type === 'presence.joined'));
    expect((joined.payload as { userId: string }).userId).toBeDefined();
    await emit(b.socket, 'presence.heartbeat', {
      room: 'board',
      id: boardId,
      state: { editing: { itemId, field: 'c_status' } },
    });
    const updated = await waitFor(() =>
      a.events.find((entry) => entry.type === 'presence.updated'),
    );
    expect(
      (updated.payload as unknown as { state: { editing: { field: string } } }).state.editing.field,
    ).toBe('c_status');
    const list = await emit<{ presence: { userId: string }[] }>(a.socket, 'subscribe', {
      room: 'board',
      id: boardId,
    });
    expect(list.presence.length).toBeGreaterThanOrEqual(1);
    await emit(b.socket, 'unsubscribe', { room: 'board', id: boardId });
    await waitFor(() => a.events.find((entry) => entry.type === 'presence.left'));
    expect(
      (
        await emit<{ ok: boolean; error?: { code: string } }>(b.socket, 'presence.heartbeat', {
          room: 'board',
          id: boardId,
          state: {},
        })
      ).error?.code,
    ).toBe('not_subscribed');
  });

  it('reconexão: replay dos eventos perdidos a partir da última sequência', async () => {
    const board = await api.get<{ seq: number }>(`/v1/boards/${boardId}`, { token: editor });
    const lastSeq = board.body.seq;
    await api.patch(`/v1/items/${itemId}`, {
      token: manager,
      body: { values: { c_status: { labelId: statusLabels[2] } } },
    });
    await api.patch(`/v1/items/${itemId}`, {
      token: manager,
      body: { values: { c_status: { labelId: statusLabels[3] } } },
    });
    const reconnected = await open(editor);
    const ack = await emit<{
      ok: boolean;
      replay: { events: RealtimeEvent[]; resyncRequired: boolean; seq: number };
    }>(reconnected.socket, 'subscribe', {
      room: 'board',
      id: boardId,
      lastSeq,
    });
    expect(ack.replay.resyncRequired).toBe(false);
    expect(ack.replay.events.map((event) => event.seq)).toEqual([lastSeq + 1, lastSeq + 2]);
    expect(ack.replay.seq).toBe(lastSeq + 2);
    const rest = await api.get<{ events: RealtimeEvent[] }>(
      `/v1/boards/${boardId}/events?after=${lastSeq}`,
      { token: editor },
    );
    expect(rest.body.events).toHaveLength(2);
    const stale = await emit<{ replay: { resyncRequired: boolean } }>(
      reconnected.socket,
      'subscribe',
      { room: 'board', id: boardId, lastSeq: lastSeq + 100 },
    );
    expect(stale.replay.resyncRequired).toBe(true);
  });

  it('não aceita alterações pelo WebSocket nem inscrição sem permissão', async () => {
    const b = await open(editor);
    const attempt = await emit<{ ok: boolean; error: { code: string } }>(b.socket, 'item.update', {
      itemId,
      values: { c_tipo: { labelId: tipoLabels[0] } },
    });
    expect(attempt).toEqual({
      ok: false,
      error: { code: 'commands_via_rest', message: 'Alterações são feitas pela API REST.' },
    });
    const signup = await api.post<{ accessToken: string }>('/v1/auth/signup', {
      body: {
        name: 'Outra Pessoa',
        email: 'ws.externo@exemplo.com',
        password: 'Senha-Segura-2026',
        organizationName: 'WS Externo',
        organizationSlug: 'ws-externo',
      },
    });
    const foreign = await open(signup.body.accessToken);
    const denied = await emit<{ ok: boolean; error: { code: string } }>(
      foreign.socket,
      'subscribe',
      { room: 'board', id: boardId },
    );
    expect(denied).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const deniedItem = await emit<{ ok: boolean }>(foreign.socket, 'subscribe', {
      room: 'item',
      id: itemId,
    });
    expect(deniedItem.ok).toBe(false);
  });

  it('logout encerra os sockets da sessão', async () => {
    const login = await api.post<{ accessToken: string }>('/v1/auth/login', {
      body: { email: USERS.rafael, password: 'CubeTrack@2026' },
    });
    const connected = await open(login.body.accessToken);
    const disconnected = new Promise<void>((resolve) =>
      connected.socket.once('disconnect', () => {
        resolve();
      }),
    );
    expect((await api.post('/v1/auth/logout', { token: login.body.accessToken })).status).toBe(204);
    await disconnected;
    expect(connected.events.some((event) => event.type === 'session.revoked')).toBe(true);
  });
});
