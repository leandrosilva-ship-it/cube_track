import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { qk } from '@/lib/query/keys';

import { BOARD_ID, makeEvent, makeItem, pagesOf } from '../../test/fixtures';
import { applyItemChanges, applyRealtimeEvent, insertItem, type ItemPages } from './apply';

const context = () => ({
  isOwnPendingMutation: vi.fn(() => false),
  onSessionRevoked: vi.fn(),
  onNotification: vi.fn(),
});

function seed(queryClient: QueryClient, params: object, data: ItemPages) {
  queryClient.setQueryData(qk.itemList(BOARD_ID, params), data);
}

describe('applyItemChanges (LWW por campo)', () => {
  it('aplica só versões maiores que a local e preserva a identidade quando nada muda', () => {
    const item = makeItem({ name: 'Antigo', fieldVersions: { name: 3 }, version: 3 });
    const stale = applyItemChanges(
      item,
      [{ field: 'name', kind: 'native', value: 'Velho', version: 2 }],
      2,
    );
    expect(stale).toBe(item);
    const fresh = applyItemChanges(
      item,
      [{ field: 'name', kind: 'native', value: 'Novo', version: 4 }],
      4,
    );
    expect(fresh.name).toBe('Novo');
    expect(fresh.fieldVersions.name).toBe(4);
    expect(fresh.version).toBe(4);
    expect(item.name).toBe('Antigo');
  });

  it('colunas customizadas: grava, e null remove o valor', () => {
    const item = makeItem({ values: { c_status: 'a', c_owner: ['u1'] } });
    const next = applyItemChanges(
      item,
      [
        { field: 'c_status', kind: 'column', value: 'b', version: 1 },
        { field: 'c_owner', kind: 'column', value: null, version: 1 },
      ],
      2,
    );
    expect(next.values).toEqual({ c_status: 'b' });
  });

  it('campos nativos mapeados (group_id → groupId) e versão do item nunca regride', () => {
    const item = makeItem({ version: 9 });
    const next = applyItemChanges(
      item,
      [{ field: 'group_id', kind: 'native', value: 'g2', version: 1 }],
      5,
    );
    expect(next.groupId).toBe('g2');
    expect(next.version).toBe(9);
  });
});

describe('applyRealtimeEvent', () => {
  it('item.created entra nas listas sem filtro e invalida as filtradas', () => {
    const queryClient = new QueryClient();
    const existing = makeItem();
    seed(queryClient, {}, pagesOf([existing]));
    seed(queryClient, { search: 'x' }, pagesOf([existing]));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const created = makeItem({ id: '01a13ae4-0000-7000-8000-000000000002', name: 'Novo' });
    applyRealtimeEvent(queryClient, makeEvent('item.created', { item: { ...created } }), context());
    const list = queryClient.getQueryData<ItemPages>(qk.itemList(BOARD_ID, {}));
    expect(list?.pages[0]?.data.map((item) => item.name)).toEqual(['Item', 'Novo']);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: qk.itemList(BOARD_ID, { search: 'x' }),
      exact: true,
    });
  });

  it('ignora o eco de uma mutação otimista própria ainda pendente', () => {
    const queryClient = new QueryClient();
    seed(queryClient, {}, pagesOf([]));
    const ctx = context();
    ctx.isOwnPendingMutation.mockReturnValue(true);
    applyRealtimeEvent(
      queryClient,
      makeEvent('item.created', { item: { ...makeItem() } }, { clientMutationId: 'm1' }),
      ctx,
    );
    expect(queryClient.getQueryData<ItemPages>(qk.itemList(BOARD_ID, {}))?.pages[0]?.data).toEqual(
      [],
    );
  });

  it('item.updated aplica patch em todas as páginas; item.deleted remove', () => {
    const queryClient = new QueryClient();
    const first = makeItem();
    const second = makeItem({ id: '01a13ae4-0000-7000-8000-000000000002', name: 'Segundo' });
    seed(queryClient, {}, pagesOf([first], [second]));
    applyRealtimeEvent(
      queryClient,
      makeEvent('item.updated', {
        itemId: second.id,
        version: 2,
        changes: [{ field: 'name', kind: 'native', value: 'Renomeado', version: 2 }],
      }),
      context(),
    );
    let list = queryClient.getQueryData<ItemPages>(qk.itemList(BOARD_ID, {}));
    expect(list?.pages[1]?.data[0]?.name).toBe('Renomeado');
    expect(list?.pages[0]).toBe(
      queryClient.getQueryData<ItemPages>(qk.itemList(BOARD_ID, {}))?.pages[0],
    );

    applyRealtimeEvent(queryClient, makeEvent('item.deleted', { itemId: first.id }), context());
    list = queryClient.getQueryData<ItemPages>(qk.itemList(BOARD_ID, {}));
    expect(list?.pages[0]?.data).toEqual([]);
    expect(list?.pages[1]?.data).toHaveLength(1);
  });

  it('insertItem não duplica um item já presente (eco após confirmação HTTP)', () => {
    const queryClient = new QueryClient();
    const item = makeItem();
    seed(queryClient, {}, pagesOf([item]));
    insertItem(queryClient, BOARD_ID, item);
    expect(
      queryClient.getQueryData<ItemPages>(qk.itemList(BOARD_ID, {}))?.pages[0]?.data,
    ).toHaveLength(1);
  });

  it('board.updated atualiza detalhe e árvore; session.revoked e notificações chamam o contexto', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(qk.boardDetail(BOARD_ID), { id: BOARD_ID, name: 'Antes' });
    queryClient.setQueryData(qk.tree('w1'), {
      workspaceId: 'w1',
      folders: [],
      boards: [{ id: BOARD_ID, name: 'Antes' }],
    });
    const ctx = context();
    applyRealtimeEvent(
      queryClient,
      makeEvent('board.updated', { changes: { name: 'Depois' } }),
      ctx,
    );
    expect(queryClient.getQueryData<{ name: string }>(qk.boardDetail(BOARD_ID))?.name).toBe(
      'Depois',
    );
    expect(
      queryClient.getQueryData<{ boards: { name: string }[] }>(qk.tree('w1'))?.boards[0]?.name,
    ).toBe('Depois');

    applyRealtimeEvent(queryClient, makeEvent('session.revoked', { sessionId: 's' }), ctx);
    expect(ctx.onSessionRevoked).toHaveBeenCalledOnce();
    applyRealtimeEvent(
      queryClient,
      makeEvent('notification.created', { title: 'Você foi mencionado' }),
      ctx,
    );
    expect(ctx.onNotification).toHaveBeenCalledWith('Você foi mencionado');
  });
});
