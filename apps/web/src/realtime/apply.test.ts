import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { qk } from '@/lib/query/keys';
import { sessionStore } from '@/stores/session';

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

type QueryKeyPredicate = (query: { queryKey: readonly unknown[] }) => boolean;

/** Algum `invalidateQueries({ predicate })` da chamada espiada bate com esta chave? */
function invalidatedByPredicate(
  invalidate: { mock: { calls: unknown[][] } },
  queryKey: readonly unknown[],
): boolean {
  return invalidate.mock.calls.some((args) => {
    const filters = args[0] as { predicate?: QueryKeyPredicate } | undefined;
    return filters?.predicate?.({ queryKey }) === true;
  });
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

describe('Prompt 5: subitens, estrutura e destaque', () => {
  it('subitem entra só na lista do pai e incrementa o indicador; eco de outra pessoa destaca a célula', async () => {
    const { highlightStore } = await import('./highlight');
    const queryClient = new QueryClient();
    const parent = makeItem({
      id: 'p1',
      indicators: { subitems: 0, attachments: 0, updates: 0, unreadUpdates: 0 },
    });
    seed(queryClient, {}, pagesOf([parent]));
    seed(queryClient, { parentItemId: 'p1' }, pagesOf([]));
    applyRealtimeEvent(
      queryClient,
      makeEvent('item.created', {
        item: {
          id: 's1',
          boardId: BOARD_ID,
          groupId: parent.groupId,
          parentItemId: 'p1',
          name: 'Sub',
          position: 'a0',
          values: {},
        },
      }),
      context(),
    );
    const main = queryClient.getQueryData<ItemPages>(qk.itemList(BOARD_ID, {}));
    const subs = queryClient.getQueryData<ItemPages>(qk.itemList(BOARD_ID, { parentItemId: 'p1' }));
    expect(main?.pages[0]?.data.map((item) => item.id)).toEqual(['p1']);
    expect(main?.pages[0]?.data[0]?.indicators?.subitems).toBe(1);
    expect(subs?.pages[0]?.data.map((item) => item.id)).toEqual(['s1']);

    applyRealtimeEvent(
      queryClient,
      makeEvent('item.updated', {
        itemId: 'p1',
        version: 2,
        changes: [{ field: 'c_ust', kind: 'column', value: { n: '3' }, version: 1 }],
      }),
      context(),
    );
    expect(highlightStore.getState().cells['p1:c_ust']).toBeGreaterThan(Date.now());
  });

  it('mudanças de estrutura invalidam o board; colunas só cosméticas recarregam só a estrutura', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('group.changed', { groupId: 'g', change: 'deleted' }),
      context(),
    );
    expect(spy).toHaveBeenLastCalledWith({ queryKey: qk.board(BOARD_ID) });
    applyRealtimeEvent(
      queryClient,
      makeEvent('column.updated', { columnId: 'c', key: 'c_x', changes: { width: 200 } }),
      context(),
    );
    expect(spy).toHaveBeenLastCalledWith({ queryKey: qk.boardDetail(BOARD_ID) });
    applyRealtimeEvent(
      queryClient,
      makeEvent('column.created', { columnId: 'c', key: 'c_y' }),
      context(),
    );
    expect(spy).toHaveBeenLastCalledWith({ queryKey: qk.board(BOARD_ID) });
  });
});

describe('Prompt 7: painel do item (atualizações, arquivos, checklists, aprovações)', () => {
  it('update.created invalida o feed e incrementa updates/unreadUpdates do indicador', () => {
    const queryClient = new QueryClient();
    const item = makeItem({ indicators: { subitems: 0, attachments: 0, updates: 2, unreadUpdates: 0 } });
    seed(queryClient, {}, pagesOf([item]));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('update.created', { updateId: 'u1', itemId: item.id, authorId: 'other-user', bodyText: 'Oi' }),
      context(),
    );
    const updated = queryClient.getQueryData<ItemPages>(qk.itemList(BOARD_ID, {}))?.pages[0]?.data[0];
    expect(updated?.indicators).toEqual({ subitems: 0, attachments: 0, updates: 3, unreadUpdates: 1 });
    expect(invalidatedByPredicate(invalidate, qk.updates(item.id))).toBe(true);
  });

  it('update.created não marca como não lida quando o autor é o próprio usuário', () => {
    const queryClient = new QueryClient();
    const item = makeItem({ indicators: { subitems: 0, attachments: 0, updates: 0, unreadUpdates: 0 } });
    seed(queryClient, {}, pagesOf([item]));
    const me = sessionStore.getState().user?.id ?? null;
    applyRealtimeEvent(
      queryClient,
      makeEvent('update.created', { updateId: 'u1', itemId: item.id, authorId: me, bodyText: 'Oi' }),
      context(),
    );
    const updated = queryClient.getQueryData<ItemPages>(qk.itemList(BOARD_ID, {}))?.pages[0]?.data[0];
    expect(updated?.indicators?.unreadUpdates).toBe(0);
  });

  it('attachment.changed ajusta o indicador de anexos conforme uploaded/deleted', () => {
    const queryClient = new QueryClient();
    const item = makeItem({ indicators: { subitems: 0, attachments: 1, updates: 0, unreadUpdates: 0 } });
    seed(queryClient, {}, pagesOf([item]));
    applyRealtimeEvent(
      queryClient,
      makeEvent('attachment.changed', { attachmentId: 'a1', itemId: item.id, change: 'uploaded' }),
      context(),
    );
    expect(
      queryClient.getQueryData<ItemPages>(qk.itemList(BOARD_ID, {}))?.pages[0]?.data[0]?.indicators
        ?.attachments,
    ).toBe(2);
    applyRealtimeEvent(
      queryClient,
      makeEvent('attachment.changed', { attachmentId: 'a1', itemId: item.id, change: 'deleted' }),
      context(),
    );
    expect(
      queryClient.getQueryData<ItemPages>(qk.itemList(BOARD_ID, {}))?.pages[0]?.data[0]?.indicators
        ?.attachments,
    ).toBe(1);
  });

  it('reply.created invalida o feed de atualizações e as respostas do update', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('reply.created', { replyId: 'r1', updateId: 'u1', itemId: 'i1', authorId: 'u', bodyText: 'Oi' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.replies('u1') });
  });

  it('checklist.changed e approval.changed invalidam suas próprias chaves e a atividade', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('checklist.changed', { itemId: 'i1', checklistId: 'c1' }),
      context(),
    );
    expect(invalidatedByPredicate(invalidate, qk.checklists('i1'))).toBe(true);
    expect(invalidatedByPredicate(invalidate, qk.activity('i1', {}))).toBe(true);

    invalidate.mockClear();
    applyRealtimeEvent(
      queryClient,
      makeEvent('approval.changed', { requestId: 'a1', itemId: 'i1', status: 'approved', requestedBy: 'u' }),
      context(),
    );
    expect(invalidatedByPredicate(invalidate, qk.approvals('i1'))).toBe(true);
  });

  it('item.updated também atualiza o cache individual do item (`qk.item`) e item.deleted invalida', () => {
    const queryClient = new QueryClient();
    const item = makeItem();
    queryClient.setQueryData(qk.item(item.id), item);
    applyRealtimeEvent(
      queryClient,
      makeEvent('item.updated', {
        itemId: item.id,
        version: 2,
        changes: [{ field: 'name', kind: 'native', value: 'Novo nome', version: 2 }],
      }),
      context(),
    );
    expect(queryClient.getQueryData<typeof item>(qk.item(item.id))?.name).toBe('Novo nome');

    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(queryClient, makeEvent('item.deleted', { itemId: item.id }), context());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.item(item.id) });
  });

  it('item.created/updated/deleted também invalidam o Gantt do board', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('item.created', { item: makeItem(), reason: 'created' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.gantt(BOARD_ID) });

    invalidate.mockClear();
    applyRealtimeEvent(
      queryClient,
      makeEvent('item.updated', {
        itemId: 'i1',
        version: 2,
        changes: [{ field: 'plannedEndDate', kind: 'native', value: '2026-12-01', version: 2 }],
      }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.gantt(BOARD_ID) });

    invalidate.mockClear();
    applyRealtimeEvent(queryClient, makeEvent('item.deleted', { itemId: 'i1' }), context());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.gantt(BOARD_ID) });
  });

  it('milestone.changed invalida marcos e Gantt; baseline.changed invalida a lista e o detalhe', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('milestone.changed', { milestoneId: 'm1', boardId: BOARD_ID, change: 'created' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.milestones(BOARD_ID) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.gantt(BOARD_ID) });

    invalidate.mockClear();
    applyRealtimeEvent(
      queryClient,
      makeEvent('baseline.changed', { baselineId: 'b1', boardId: BOARD_ID, change: 'captured' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.baselines(BOARD_ID) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.baseline('b1') });
  });

  it('phase/process_config/sla.changed invalidam a config de processo e os SLAs do board', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('phase.changed', { phaseId: 'ph1', boardId: BOARD_ID, change: 'created' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.processConfig(BOARD_ID) });

    invalidate.mockClear();
    applyRealtimeEvent(
      queryClient,
      makeEvent('process_config.changed', { boardId: BOARD_ID, change: 'sla_created' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.processConfig(BOARD_ID) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.slas(BOARD_ID) });

    invalidate.mockClear();
    applyRealtimeEvent(
      queryClient,
      makeEvent('sla.changed', { trackerId: 't1', itemId: 'i1', boardId: BOARD_ID, status: 'warning' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.slaTrackers(BOARD_ID) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.slas(BOARD_ID) });
  });

  it('webhook.changed invalida a lista de webhooks do board', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('webhook.changed', {
        webhookId: 'w1',
        workspaceId: null,
        boardId: BOARD_ID,
        change: 'created',
      }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.webhooksOfBoard(BOARD_ID) });
  });

  it('time_entry.changed invalida os apontamentos do item e, por predicado, os da pessoa', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('time_entry.changed', {
        timeEntryId: 'te1',
        userId: 'user-1',
        boardId: BOARD_ID,
        itemId: 'item-1',
        change: 'created',
      }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.timeEntriesOfItem('item-1') });
    expect(invalidatedByPredicate(invalidate, qk.timeEntriesOfUser('user-1', '2024-01-01', '2024-01-07'))).toBe(
      true,
    );
  });

  it('timesheet_approval.changed invalida as aprovações da pessoa e a fila de pendentes', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('timesheet_approval.changed', {
        approvalId: 'ap1',
        userId: 'user-1',
        periodStart: '2024-01-01',
        status: 'submitted',
      }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.timesheetApprovalsOfUser('user-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.timesheetApprovalsPending() });
  });
});

describe('Prompt 12: portfólio, governança e RAG automático', () => {
  it('portfolio.changed e program.changed invalidam a lista do workspace e o próprio rollup', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('portfolio.changed', { portfolioId: 'pf1', workspaceId: 'ws1', change: 'updated' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.portfoliosOf('ws1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.portfolio('pf1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.portfolioRollup('pf1') });

    applyRealtimeEvent(
      queryClient,
      makeEvent('program.changed', { programId: 'pg1', workspaceId: 'ws1', portfolioId: 'pf1', change: 'created' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.programsOf('ws1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.program('pg1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.programRollup('pg1') });
  });

  it('score.changed invalida o ranking e a matriz valor×esforço do modelo', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('score.changed', { scoreId: 's1', scoringModelId: 'sm1', boardId: BOARD_ID }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.scoringRanking('sm1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.scoringValueEffort('sm1') });
  });

  it('stage_gate/risk/issue.changed invalidam a lista do board correspondente', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('stage_gate.changed', { gateId: 'g1', boardId: BOARD_ID, change: 'decided' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.stageGatesOfBoard(BOARD_ID) });

    applyRealtimeEvent(
      queryClient,
      makeEvent('risk.changed', { riskId: 'r1', boardId: BOARD_ID, change: 'created' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.risksOfBoard(BOARD_ID) });

    applyRealtimeEvent(
      queryClient,
      makeEvent('issue.changed', { issueId: 'i1', boardId: BOARD_ID, change: 'resolved' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.issuesOfBoard(BOARD_ID) });
  });

  it('budget.changed invalida os orçamentos do board; cost_entry.changed invalida os lançamentos do orçamento', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('budget.changed', { budgetId: 'b1', boardId: BOARD_ID, programId: null, portfolioId: null, change: 'created' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.budgetsOfBoard(BOARD_ID) });

    applyRealtimeEvent(
      queryClient,
      makeEvent('cost_entry.changed', { costEntryId: 'c1', budgetId: 'b1', boardId: BOARD_ID, change: 'created' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.costEntriesOfBudget('b1') });
  });

  it('project_health.changed (RAG/EVM automático) invalida a saúde, o status report e, por predicado, rollups/relatórios/dashboards', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('project_health.changed', { healthId: 'ph1', boardId: BOARD_ID, overall: 'yellow', isAutomatic: true }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.projectHealth(BOARD_ID) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.boardStatusReport(BOARD_ID) });
    expect(invalidatedByPredicate(invalidate, qk.portfolioRollup('qualquer-pf'))).toBe(true);
    expect(invalidatedByPredicate(invalidate, qk.programRollup('qualquer-pg'))).toBe(true);
  });

  it('health_rule_set.changed invalida o padrão do tenant (boardId nulo) ou as regras do board', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(queryClient, makeEvent('health_rule_set.changed', { ruleSetId: 'hr1', boardId: null }), context());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.healthRulesDefault() });

    applyRealtimeEvent(
      queryClient,
      makeEvent('health_rule_set.changed', { ruleSetId: 'hr2', boardId: BOARD_ID }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.healthRulesOfBoard(BOARD_ID) });
  });
});

describe('Prompt 13: Contratos/OS/UST', () => {
  it('contract.changed invalida a lista do workspace, o contrato e, por predicado, os dados de dashboards (widgets de UST)', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('contract.changed', { contractId: 'ct1', workspaceId: 'ws1', change: 'updated' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.contractsOf('ws1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.contract('ct1') });
    expect(invalidatedByPredicate(invalidate, ['dashboards', 'qualquer-id', 'data'])).toBe(true);
  });

  it('service_catalog_item.changed invalida o catálogo do contrato', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('service_catalog_item.changed', { catalogItemId: 'ci1', contractId: 'ct1', change: 'created' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.catalogOf('ct1') });
  });

  it('service_order.changed invalida o contrato (saldo ao vivo) e a lista do board/OS do item quando presentes', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('service_order.changed', {
        serviceOrderId: 'so1',
        contractId: 'ct1',
        boardId: BOARD_ID,
        itemId: 'it1',
        change: 'updated',
      }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.contract('ct1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.serviceOrdersOfBoard(BOARD_ID) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.serviceOrderOfItem('it1') });
    // ContractsPage mostra o saldo a partir da LISTA (`qk.contractsOf`), não de `qk.contract`
    // isoladamente (nenhuma tela usa essa chave) — sem workspaceId no payload, invalida por
    // predicado qualquer lista de contratos de workspace já em cache.
    expect(invalidatedByPredicate(invalidate, qk.contractsOf('qualquer-ws'))).toBe(true);

    invalidate.mockClear();
    applyRealtimeEvent(
      queryClient,
      makeEvent('service_order.changed', {
        serviceOrderId: 'so2',
        contractId: 'ct1',
        boardId: null,
        itemId: null,
        change: 'created',
      }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.contract('ct1') });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: qk.serviceOrdersOfBoard(BOARD_ID) });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: qk.serviceOrderOfItem('it1') });
  });

  it('measurement.changed invalida as medições do contrato', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('measurement.changed', { measurementId: 'm1', contractId: 'ct1', change: 'approved' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.measurementsOf('ct1') });
  });

  it('invoice.changed invalida as faturas do contrato', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyRealtimeEvent(
      queryClient,
      makeEvent('invoice.changed', { invoiceId: 'inv1', contractId: 'ct1', change: 'updated' }),
      context(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.invoicesOf('ct1') });
  });
});
