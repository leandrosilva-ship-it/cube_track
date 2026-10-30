import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  adminDb,
  client,
  demoIds,
  requiredValues,
  resetRateLimits,
  startApi,
  USERS,
  type ApiClient,
  type ApiServer,
} from './helpers.js';

interface Contract {
  id: string;
  workspaceId: string;
  number: string;
  ustUnitPrice: string;
  balance: { ustContracted: number; ustConsumed: number; ustBalance: number; percentConsumed: number };
}
interface CatalogItem {
  id: string;
  code: string;
  defaultUst: string;
}
interface ServiceOrderItem {
  id: string;
  catalogItemId: string;
  quantity: string;
  ustUnit: string;
  ustTotal: string;
  ustOverrideReason: string | null;
}
interface ServiceOrder {
  id: string;
  status: string;
  totalUst: string;
  acceptedAt: string | null;
  items: ServiceOrderItem[];
}
interface Measurement {
  id: string;
  status: string;
  measuredUst: string;
  glosaUst: string;
  approvedUst: string | null;
  amount: string | null;
}
interface Invoice {
  id: string;
  status: string;
  amount: string;
  measurementId: string | null;
}

describe('Módulo Contratos/OS/UST — gestão, auto-fill, ciclo da OS, saldo, medição e faturamento (ADR 0054)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let ana: string; // workspace_admin: contract.manage/measure
  let rafael: string; // sem contract.manage
  let workspaceId: string;
  let boardId: string;
  let contractId: string;
  let itemId: string;

  const db = adminDb();

  beforeAll(async () => {
    await resetRateLimits();
    server = await startApi();
    api = client(server.url);
    ana = await api.login(USERS.ana);
    rafael = await api.login(USERS.rafael);
    const demo = await demoIds(api, ana);
    workspaceId = demo.workspaceId;
    boardId = demo.boardId;

    const contracts = await api.get<{ data: Contract[] }>(`/v1/workspaces/${workspaceId}/contracts`, { token: ana });
    contractId = contracts.body.data.find((row) => row.number === '012/2025')?.id ?? '';

    const groupId = demo.board.groups[0]?.id ?? '';
    const created = await api.post<{ id: string }>(`/v1/boards/${boardId}/items`, {
      token: ana,
      body: { groupId, name: 'Item de teste — OS/UST', values: requiredValues(demo.board) },
    });
    itemId = created.body.id;
  });

  afterAll(async () => {
    if (itemId !== '') await api.delete(`/v1/items/${itemId}`, { token: ana });
    await db.close();
    await server.close();
  });

  describe('Contratos e catálogo', () => {
    it('lista o contrato semeado com saldo calculado ao vivo; só `contract.manage` cria/atualiza', async () => {
      expect(contractId).not.toBe('');
      const readable = await api.get<{ data: Contract[] }>(`/v1/workspaces/${workspaceId}/contracts`, { token: rafael });
      expect(readable.status).toBe(200);
      expect(readable.body.data.some((row) => row.id === contractId)).toBe(true);

      const forbidden = await api.post(`/v1/workspaces/${workspaceId}/contracts`, {
        token: rafael,
        body: {
          number: 'TESTE-1',
          title: 'Contrato de teste',
          clientName: 'Cliente teste',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          ustUnitPrice: '100.00',
          ustContracted: '1000.0000',
          totalValue: '100000.00',
        },
      });
      expect(forbidden.status).toBe(403);

      const created = await api.post<Contract>(`/v1/workspaces/${workspaceId}/contracts`, {
        token: ana,
        body: {
          number: 'TESTE-1',
          title: 'Contrato de teste',
          clientName: 'Cliente teste',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          ustUnitPrice: '100.00',
          ustContracted: '1000.0000',
          totalValue: '100000.00',
        },
      });
      expect(created.status).toBe(201);
      expect(created.body.balance.ustBalance).toBe(1000);
    });

    it('catálogo de serviços: cria item (Código Edital) e recusa duplicar o código no mesmo contrato', async () => {
      const created = await api.post<CatalogItem>(`/v1/contracts/${contractId}/catalog-items`, {
        token: ana,
        body: { code: `TST-${Date.now()}`, name: 'Serviço de teste', defaultUst: '10.0000' },
      });
      expect(created.status).toBe(201);
      const duplicate = await api.post(`/v1/contracts/${contractId}/catalog-items`, {
        token: ana,
        body: { code: created.body.code, name: 'Outro nome', defaultUst: '5.0000' },
      });
      expect(duplicate.status).toBe(409);
    });
  });

  describe('Ordem de Serviço: auto-fill de UST, override auditado, ciclo e saldo (critério de aceite 1)', () => {
    let catalogItemId: string;
    let catalogDefaultUst: number;
    let serviceOrderId: string;
    let orderTotalUst: number;

    beforeAll(async () => {
      const catalog = await api.get<{ data: CatalogItem[] }>(`/v1/contracts/${contractId}/catalog-items`, { token: ana });
      const d1 = catalog.body.data.find((row) => row.code === 'D1');
      catalogItemId = d1?.id ?? '';
      catalogDefaultUst = Number(d1?.defaultUst ?? 0);
      expect(catalogItemId).not.toBe('');
    });

    it('cria a OS vinculada ao item e preenche a UST automaticamente a partir do catálogo', async () => {
      const created = await api.post<ServiceOrder>(`/v1/items/${itemId}/service-order`, {
        token: ana,
        body: { number: `OS-TESTE-${Date.now()}` },
      });
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('draft');
      serviceOrderId = created.body.id;

      const forbiddenLine = await api.post(`/v1/service-orders/${serviceOrderId}/items`, {
        token: rafael,
        body: { catalogItemId, quantity: '1' },
      });
      expect(forbiddenLine.status).toBe(403);

      const line = await api.post<ServiceOrder>(`/v1/service-orders/${serviceOrderId}/items`, {
        token: ana,
        body: { catalogItemId, quantity: '2' },
      });
      expect(line.status).toBe(201);
      const added = line.body.items.at(-1);
      expect(Number(added?.ustUnit)).toBeCloseTo(catalogDefaultUst, 4);
      expect(Number(added?.ustTotal)).toBeCloseTo(catalogDefaultUst * 2, 4);
      expect(Number(line.body.totalUst)).toBeCloseTo(catalogDefaultUst * 2, 4);
      orderTotalUst = Number(line.body.totalUst);
    });

    it('ajuste manual da UST exige justificativa (auditado) — sem motivo é rejeitado', async () => {
      const withoutReason = await api.post(`/v1/service-orders/${serviceOrderId}/items`, {
        token: ana,
        body: { catalogItemId, quantity: '1', ustUnit: String(catalogDefaultUst + 5) },
      });
      expect(withoutReason.status).toBe(400);

      const withReason = await api.post<ServiceOrder>(`/v1/service-orders/${serviceOrderId}/items`, {
        token: ana,
        body: {
          catalogItemId,
          quantity: '1',
          ustUnit: String(catalogDefaultUst + 5),
          ustOverrideReason: 'Complexidade adicional acordada com o órgão.',
        },
      });
      expect(withReason.status).toBe(201);
      const overridden = withReason.body.items.at(-1);
      expect(overridden?.ustOverrideReason).toBe('Complexidade adicional acordada com o órgão.');
      orderTotalUst = Number(withReason.body.totalUst);
      expect(orderTotalUst).toBeCloseTo(catalogDefaultUst * 2 + (catalogDefaultUst + 5), 4);
    });

    it('saldo do contrato só muda quando a OS chega a "aceita" — critério de aceite 1', async () => {
      const before = await api.get<Contract>(`/v1/contracts/${contractId}`, { token: ana });
      const balanceBeforeAccept = before.body.balance.ustConsumed;

      for (const to of ['requested', 'issued', 'in_progress', 'delivered']) {
        const transitioned = await api.post<ServiceOrder>(`/v1/service-orders/${serviceOrderId}/transition`, {
          token: ana,
          body: { to },
        });
        expect(transitioned.status).toBe(200);
        expect(transitioned.body.status).toBe(to);
      }

      const stillSame = await api.get<Contract>(`/v1/contracts/${contractId}`, { token: ana });
      expect(stillSame.body.balance.ustConsumed).toBe(balanceBeforeAccept);

      const invalid = await api.post(`/v1/service-orders/${serviceOrderId}/transition`, {
        token: ana,
        body: { to: 'invoiced' },
      });
      expect(invalid.status).toBe(422);

      const accepted = await api.post<ServiceOrder>(`/v1/service-orders/${serviceOrderId}/transition`, {
        token: ana,
        body: { to: 'accepted' },
      });
      expect(accepted.status).toBe(200);
      expect(accepted.body.status).toBe('accepted');

      const after = await api.get<Contract>(`/v1/contracts/${contractId}`, { token: ana });
      expect(after.body.balance.ustConsumed).toBeCloseTo(balanceBeforeAccept + orderTotalUst, 4);
      expect(after.body.balance.ustBalance).toBeCloseTo(after.body.balance.ustContracted - after.body.balance.ustConsumed, 4);
    });
  });

  describe('Medição mensal e faturamento — critério de aceite 2', () => {
    let measurementId: string;

    it('medição do período de hoje confere exatamente com a soma das OS aceitas no período', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const generated = await api.post<Measurement>(`/v1/contracts/${contractId}/measurements/generate`, {
        token: ana,
        body: { periodStart: today, periodEnd: today },
      });
      expect(generated.status).toBe(201);
      measurementId = generated.body.id;
      expect(generated.body.status).toBe('draft');

      const orders = await api.get<{ data: ServiceOrder[] }>(`/v1/boards/${boardId}/service-orders`, { token: ana });
      const consuming = new Set(['accepted', 'measured', 'invoiced']);
      const acceptedToday = orders.body.data.filter((row) => consuming.has(row.status) && row.acceptedAt === today);
      const expectedSum = acceptedToday.reduce((sum, row) => sum + Number(row.totalUst), 0);
      expect(Number(generated.body.measuredUst)).toBeCloseTo(expectedSum, 4);
    });

    it('aprova a medição (recalcula approvedUst/amount) e fatura', async () => {
      const forbidden = await api.post(`/v1/measurements/${measurementId}/decide`, {
        token: rafael,
        body: { status: 'approved' },
      });
      expect(forbidden.status).toBe(403);

      const measurementBefore = await api.get<{ data: Measurement[] }>(`/v1/contracts/${contractId}/measurements`, { token: ana });
      const current = measurementBefore.body.data.find((row) => row.id === measurementId);
      expect(current).toBeDefined();

      const decided = await api.post<Measurement>(`/v1/measurements/${measurementId}/decide`, {
        token: ana,
        body: { status: 'approved' },
      });
      expect(decided.status).toBe(200);
      expect(decided.body.status).toBe('approved');
      expect(decided.body.approvedUst).not.toBeNull();
      expect(Number(decided.body.approvedUst)).toBeCloseTo(Number(decided.body.measuredUst) - Number(decided.body.glosaUst), 4);
      expect(decided.body.amount).not.toBeNull();

      const contract = await api.get<Contract>(`/v1/contracts/${contractId}`, { token: ana });
      const expectedAmount = Number(decided.body.approvedUst) * Number(contract.body.ustUnitPrice);
      expect(Number(decided.body.amount)).toBeCloseTo(expectedAmount, 1);

      const invoice = await api.post<Invoice>(`/v1/measurements/${measurementId}/invoice`, {
        token: ana,
        body: { number: `NF-TESTE-${Date.now()}` },
      });
      expect(invoice.status).toBe(201);
      expect(invoice.body.status).toBe('issued');
      expect(Number(invoice.body.amount)).toBeCloseTo(Number(decided.body.amount), 4);

      const duplicate = await api.post(`/v1/measurements/${measurementId}/invoice`, {
        token: ana,
        body: { number: `NF-TESTE-2-${Date.now()}` },
      });
      expect(duplicate.status).toBe(409);

      const paid = await api.post<Invoice>(`/v1/invoices/${invoice.body.id}/transition`, {
        token: ana,
        body: { to: 'paid' },
      });
      expect(paid.status).toBe(200);
      expect(paid.body.status).toBe('paid');
    });
  });

  describe('Enforcement do módulo opcional `contracts` (ADR 0017/0054)', () => {
    it('workspace sem o módulo `contracts` ativo: rotas do módulo somem (404)', async () => {
      const current = await api.get<{ data: Contract[] }>(`/v1/workspaces/${workspaceId}/contracts`, { token: ana });
      expect(current.status).toBe(200);

      const disabled = await api.patch(`/v1/workspaces/${workspaceId}`, {
        token: ana,
        body: { enabledModules: ['core', 'agile', 'process', 'schedule', 'resources', 'portfolio'] },
      });
      expect(disabled.status).toBe(200);

      try {
        const blocked = await api.get(`/v1/contracts/${contractId}`, { token: ana });
        expect(blocked.status).toBe(404);
        const blockedList = await api.get(`/v1/workspaces/${workspaceId}/contracts`, { token: ana });
        expect(blockedList.status).toBe(404);
      } finally {
        const restored = await api.patch(`/v1/workspaces/${workspaceId}`, {
          token: ana,
          body: { enabledModules: ['core', 'agile', 'process', 'schedule', 'resources', 'portfolio', 'contracts'] },
        });
        expect(restored.status).toBe(200);
      }
    });
  });
});
