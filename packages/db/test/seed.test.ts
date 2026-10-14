import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenant, type DatabaseHandle } from '../src/client.js';
import {
  boards,
  columnDefinitions,
  dropdownOptions,
  folders,
  groups,
  items,
  memberships,
  serviceCatalogItems,
  serviceOrderItems,
  serviceOrders,
  statusLabels,
  updates,
  views,
  workspaces,
} from '../src/schema/index.js';
import { DEMO_TENANT_ID } from '../src/seed/context.js';
import { seedDemo } from '../src/seed/demo.js';
import { appDatabase, ensureDemo } from './helpers.js';

describe('Seed de demonstração (caso PMSP)', () => {
  let app: DatabaseHandle;
  const inDemo = <T>(work: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(app.db, { tenantId: DEMO_TENANT_ID }, work);

  beforeAll(async () => {
    app = appDatabase();
    await ensureDemo(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  it('é idempotente', async () => {
    const again = await seedDemo(app.db);
    expect(again.created).toBe(false);
  });

  it('cria workspace e as pastas do caso de referência', async () => {
    const result = await inDemo(async (tx) => ({
      workspaces: await tx.select({ name: workspaces.name }).from(workspaces),
      folders: await tx.select({ name: folders.name }).from(folders).orderBy(folders.position),
    }));
    expect(result.workspaces.map((row) => row.name)).toEqual(['Área de trabalho principal']);
    expect(result.folders.map((row) => row.name)).toEqual([
      'Implantações Concluídas',
      'Sustentação',
      'Projetos Concluídos',
      'Demandas internas',
      'Templates',
    ]);
  });

  it('cria 8 membros e 1 convidado externo', async () => {
    const rows = await inDemo((tx) =>
      tx
        .select({ kind: memberships.kind, total: count() })
        .from(memberships)
        .groupBy(memberships.kind),
    );
    expect(Object.fromEntries(rows.map((row) => [row.kind, row.total]))).toEqual({
      member: 8,
      guest: 1,
    });
  });

  it('cria o board PMSP com grupos, colunas e ~60 demandas', async () => {
    const result = await inDemo(async (tx) => {
      const [board] = await tx.select().from(boards).where(eq(boards.name, 'PMSP'));
      if (board === undefined) throw new Error('Board PMSP ausente');
      return {
        board,
        groups: await tx
          .select({ name: groups.name })
          .from(groups)
          .where(eq(groups.boardId, board.id))
          .orderBy(groups.position),
        columns: await tx
          .select({ title: columnDefinitions.title })
          .from(columnDefinitions)
          .where(eq(columnDefinitions.boardId, board.id)),
        items: await tx
          .select({ total: count() })
          .from(items)
          .where(and(eq(items.boardId, board.id), isNull(items.parentItemId))),
        views: await tx.select({ name: views.name }).from(views).where(eq(views.boardId, board.id)),
      };
    });
    expect(result.board.kind).toBe('project');
    expect(result.groups.map((row) => row.name)).toEqual([
      'Demandas em Análise',
      'Demandas em Andamento',
      'Concluídas',
    ]);
    expect(result.columns.map((row) => row.title)).toEqual(
      expect.arrayContaining([
        'Órgão',
        'Nº Ordem de Serviço',
        'Processo SEI',
        'Data Emissão OS',
        'Data de início',
        'Frente de Trabalho',
        'Responsáveis',
        'Código Edital',
        'OS solicitada',
        'OS emitida',
        'Tipo de tarefa',
        'Qtde de UST',
        'Término Planejado',
        'Término Replanejado',
        'Término Realizado',
        'Data de faturamento',
      ]),
    );
    expect(result.items[0]?.total).toBe(60);
    expect(result.views.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'Quadro principal',
        'Kanban por Frente',
        'Prazo de Entrega',
        'Cronograma',
        'Project Health',
      ]),
    );
  });

  it('cadastra frentes, órgãos e o catálogo de códigos do edital', async () => {
    const result = await inDemo(async (tx) => ({
      frentes: await tx
        .select({ label: statusLabels.label })
        .from(statusLabels)
        .innerJoin(columnDefinitions, eq(columnDefinitions.id, statusLabels.columnId))
        .where(eq(columnDefinitions.key, 'c_frente')),
      orgaos: await tx.select({ label: dropdownOptions.label }).from(dropdownOptions),
      catalog: await tx.select({ code: serviceCatalogItems.code }).from(serviceCatalogItems),
    }));
    expect(result.frentes.map((row) => row.label).sort()).toEqual(
      [
        'Aplicativo',
        'BI',
        'Formulário',
        'Integração',
        'Mapeamento e Redesenho',
        'Portal',
        'SIGRC',
      ].sort(),
    );
    expect(result.orgaos.map((row) => row.label).sort()).toEqual(
      ['COHAB', 'OGM', 'Ouvidoria SUS', 'SMIT', 'SMPED'].sort(),
    );
    expect(result.catalog.map((row) => row.code).sort()).toEqual(
      ['CP1', 'CP2', 'CP5', 'D1', 'D2', 'D3', 'D4', 'D6', 'D7', 'D9', 'M3', 'M5'].sort(),
    );
  });

  it('mantém UST da OS igual à soma das linhas do catálogo', async () => {
    const mismatches = await inDemo((tx) =>
      tx
        .select({ id: serviceOrders.id })
        .from(serviceOrders)
        .leftJoin(serviceOrderItems, eq(serviceOrderItems.serviceOrderId, serviceOrders.id))
        .groupBy(serviceOrders.id, serviceOrders.totalUst)
        .having(sql`${serviceOrders.totalUst} <> coalesce(sum(${serviceOrderItems.ustTotal}), 0)`),
    );
    expect(mismatches).toEqual([]);
  });

  it('inclui os itens citados no caso de referência com IDs automáticos mascarados', async () => {
    const names = [
      'COHAB - SIGRC - Transferência de titularidade do imóvel',
      'SMIT - SEI – Redesenho Integração SEI',
      'OGM - Portal - Aba OGM',
      'Ouvidoria SUS - 23ª Atualização de base de dados, API Creator',
    ];
    const rows = await inDemo((tx) =>
      tx
        .select({ name: items.name, values: items.values })
        .from(items)
        .where(sql`${items.name} in ${names}`),
    );
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.values.c_id?.text).toMatch(/^\d{4}-\d{4}$/);
  });

  it('registra atualizações com menções nas demandas', async () => {
    const result = await inDemo((tx) => tx.select({ total: count() }).from(updates));
    expect(result[0]?.total).toBeGreaterThanOrEqual(60);
  });
});
