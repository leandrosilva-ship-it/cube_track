import { QueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { qk } from '@/lib/query/keys';

import { BOARD_ID, makeEvent, makeItem, pagesOf } from '../../test/fixtures';
import type { ItemPages } from './apply';
import { RealtimeClient } from './client';
import { realtimeStore } from './store';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ api: apiMock }));

type Handler = (...args: unknown[]) => void;

/** Socket mínimo: registra handlers e respostas de `subscribe`, permite disparar eventos. */
class FakeSocket {
  connected = true;
  auth: unknown = {};
  readonly handlers = new Map<string, Handler>();
  readonly emitted: [string, unknown][] = [];
  ack: unknown = { ok: true, room: `t:x:b:${BOARD_ID}`, presence: [] };
  readonly io = { on: vi.fn() };

  on(event: string, handler: Handler) {
    this.handlers.set(event, handler);
    return this;
  }

  fire(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.(...args);
  }

  emit(event: string, payload: unknown) {
    this.emitted.push([event, payload]);
    return this;
  }

  timeout() {
    return {
      emitWithAck: (event: string, payload: unknown) => {
        this.emitted.push([event, payload]);
        return Promise.resolve(this.ack);
      },
    };
  }

  removeAllListeners() {
    this.handlers.clear();
  }

  disconnect() {
    this.connected = false;
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const renamed = (seq: number, name: string, version: number) =>
  makeEvent(
    'item.updated',
    {
      itemId: makeItem().id,
      version,
      changes: [{ field: 'name', kind: 'native', value: name, version }],
    },
    { seq },
  );

describe('RealtimeClient', () => {
  let queryClient: QueryClient;
  let socket: FakeSocket;
  let client: RealtimeClient;

  beforeEach(async () => {
    apiMock.mockReset();
    queryClient = new QueryClient();
    queryClient.setQueryData(qk.itemList(BOARD_ID, {}), pagesOf([makeItem()]));
    socket = new FakeSocket();
    client = new RealtimeClient(queryClient, () => Promise.resolve(socket as unknown as Socket), {
      isOwnPendingMutation: () => false,
      onSessionRevoked: vi.fn(),
      onNotification: vi.fn(),
    });
    client.start('token');
    await flush();
    socket.fire('ready');
  });

  afterEach(() => {
    client.stop();
  });

  const currentName = () =>
    queryClient.getQueryData<ItemPages>(qk.itemList(BOARD_ID, {}))?.pages[0]?.data[0]?.name;

  it('conecta, assina o board com a base de sequência e envia heartbeat de presença', async () => {
    expect(realtimeStore.getState().status).toBe('online');
    client.watchBoard(BOARD_ID, { viewId: 'v1' });
    client.setBaseline(BOARD_ID, 10);
    await flush();
    expect(socket.emitted[0]).toEqual(['subscribe', { room: 'board', id: BOARD_ID }]);
    expect(socket.emitted).toContainEqual([
      'presence.heartbeat',
      { room: 'board', id: BOARD_ID, state: { viewId: 'v1' } },
    ]);
  });

  it('aplica eventos em ordem, descarta duplicados e antigos', async () => {
    client.watchBoard(BOARD_ID);
    client.setBaseline(BOARD_ID, 1);
    await flush();
    const event = renamed(2, 'Dois', 2);
    client.handle(event);
    expect(currentName()).toBe('Dois');
    client.handle(event);
    client.handle(renamed(1, 'Velho', 9));
    expect(currentName()).toBe('Dois');
  });

  it('lacuna de sequência busca o replay e aplica os eventos faltantes', async () => {
    client.watchBoard(BOARD_ID);
    client.setBaseline(BOARD_ID, 1);
    await flush();
    apiMock.mockResolvedValue({
      events: [renamed(2, 'Dois', 2), renamed(3, 'Três', 3)],
      resyncRequired: false,
      seq: 3,
    });
    client.handle(renamed(3, 'Três', 3));
    await flush();
    expect(apiMock).toHaveBeenCalledWith(`/v1/boards/${BOARD_ID}/events`, {
      query: { after: 1 },
    });
    expect(currentName()).toBe('Três');
  });

  it('replay impossível (resyncRequired) invalida o board inteiro', async () => {
    client.watchBoard(BOARD_ID);
    client.setBaseline(BOARD_ID, 1);
    await flush();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    apiMock.mockResolvedValue({ events: [], resyncRequired: true, seq: 50 });
    client.handle(renamed(40, 'Longe', 40));
    await flush();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.board(BOARD_ID) });
  });

  it('presença entra e sai do store; liberar a última referência cancela a assinatura', async () => {
    const release = client.watchBoard(BOARD_ID);
    const releaseAgain = client.watchBoard(BOARD_ID);
    await flush();
    const room = `t:x:b:${BOARD_ID}`;
    client.handle(makeEvent('presence.joined', { room, userId: 'u2', state: {} }));
    expect(realtimeStore.getState().presence[room]).toHaveLength(1);
    client.handle(makeEvent('presence.left', { room, userId: 'u2' }));
    expect(realtimeStore.getState().presence[room] ?? []).toHaveLength(0);
    release();
    expect(socket.emitted.some(([name]) => name === 'unsubscribe')).toBe(false);
    releaseAgain();
    expect(socket.emitted).toContainEqual(['unsubscribe', { room: 'board', id: BOARD_ID }]);
  });

  it('stop antes do socket ficar pronto descarta a conexão atrasada', async () => {
    const late = new FakeSocket();
    let resolve: (value: Socket) => void = () => undefined;
    const pending = new RealtimeClient(
      queryClient,
      () =>
        new Promise<Socket>((done) => {
          resolve = done;
        }),
      { isOwnPendingMutation: () => false, onSessionRevoked: vi.fn(), onNotification: vi.fn() },
    );
    pending.start('token');
    pending.stop();
    resolve(late as unknown as Socket);
    await flush();
    expect(late.connected).toBe(false);
    expect(late.handlers.size).toBe(0);
  });
});
