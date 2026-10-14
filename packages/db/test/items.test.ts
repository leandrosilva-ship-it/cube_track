import { formatDisplayId, newId } from '@cube-track/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenant, type DatabaseHandle } from '../src/client.js';
import {
  boards,
  columnDefinitions,
  groups,
  itemFieldIndex,
  items,
  workCalendars,
} from '../src/schema/index.js';
import { appDatabase, createSmallTenant, expectPgError, type SmallTenant } from './helpers.js';

describe('Itens: ID automático, projeção tipada e hierarquia', () => {
  let app: DatabaseHandle;
  let tenant: SmallTenant;

  beforeAll(async () => {
    app = appDatabase();
    tenant = await createSmallTenant(app.db, `items-${Date.now()}`);
    await withTenant(app.db, { tenantId: tenant.tenantId }, (tx) =>
      tx.insert(columnDefinitions).values([
        {
          tenantId: tenant.tenantId,
          boardId: tenant.boardId,
          key: 'c_ust',
          type: 'number',
          title: 'UST',
          position: 'a1',
        },
        {
          tenantId: tenant.tenantId,
          boardId: tenant.boardId,
          key: 'c_prazo',
          type: 'date',
          title: 'Prazo',
          position: 'a2',
        },
        {
          tenantId: tenant.tenantId,
          boardId: tenant.boardId,
          key: 'c_periodo',
          type: 'timeline',
          title: 'Período',
          position: 'a3',
        },
        {
          tenantId: tenant.tenantId,
          boardId: tenant.boardId,
          key: 'c_ok',
          type: 'checkbox',
          title: 'OK',
          position: 'a4',
        },
        {
          tenantId: tenant.tenantId,
          boardId: tenant.boardId,
          key: 'c_tags',
          type: 'tags',
          title: 'Tags',
          position: 'a5',
        },
        {
          tenantId: tenant.tenantId,
          boardId: tenant.boardId,
          key: 'c_os',
          type: 'text',
          title: 'OS',
          binding: 'service_order.number',
          position: 'a6',
        },
      ]),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const insertItem = (
    name: string,
    values: Record<string, Record<string, unknown>> = {},
    extra: Partial<typeof items.$inferInsert> = {},
  ) =>
    withTenant(app.db, { tenantId: tenant.tenantId }, async (tx) => {
      const [row] = await tx
        .insert(items)
        .values({
          tenantId: tenant.tenantId,
          boardId: tenant.boardId,
          groupId: tenant.groupId,
          name,
          position: `b${name}`,
          values,
          ...extra,
        })
        .returning();
      if (row === undefined) throw new Error('insert sem retorno');
      return row;
    });

  it('gera IDs automáticos sequenciais com a máscara da coluna', async () => {
    const first = await insertItem('primeiro');
    const second = await insertItem('segundo');
    const seqA = first.values.c_id?.seq as number;
    expect(first.values.c_id).toEqual({ text: `T-${String(seqA).padStart(3, '0')}`, seq: seqA });
    expect(second.values.c_id?.seq).toBe(seqA + 1);
  });

  it('não sobrescreve um ID informado (ex.: importação)', async () => {
    const imported = await insertItem('importado', { c_id: { text: 'T-900', seq: 900 } });
    expect(imported.values.c_id).toEqual({ text: 'T-900', seq: 900 });
  });

  it('a função SQL de máscara produz o mesmo resultado que a implementação TypeScript', async () => {
    const cases: [string, number, string][] = [
      ['{YYYY}-{SEQ:4}', 924, '2026-03-07'],
      ['PMSP/{YY}{MM}{DD}-{SEQ}', 12, '2026-03-07'],
      ['{SEQ:2}', 12345, '2025-12-31'],
      ['OS {SEQ:3}/{YYYY}', 7, '2027-01-01'],
    ];
    for (const [mask, seq, date] of cases) {
      const result = await app.db.execute<{ value: string }>(
        sql`select app.format_display_id(${mask}, ${seq}::bigint, ${date}::date) as value`,
      );
      const [year, month, day] = date.split('-').map(Number) as [number, number, number];
      expect(result.rows[0]?.value).toBe(formatDisplayId(mask, seq, { year, month, day }));
    }
  });

  it('projeta valores escalares em item_field_index e ignora colunas vinculadas e multivaloradas', async () => {
    const item = await insertItem('projetado', {
      c_ust: { n: '42.5' },
      c_prazo: { d: '2026-11-30' },
      c_periodo: { from: '2026-11-01', to: '2026-11-20' },
      c_ok: { checked: true },
      c_tags: { tags: ['a'] },
      c_os: { text: 'não deveria projetar' },
    });
    const rows = await withTenant(app.db, { tenantId: tenant.tenantId }, (tx) =>
      tx
        .select()
        .from(itemFieldIndex)
        .where(eq(itemFieldIndex.itemId, item.id))
        .orderBy(asc(itemFieldIndex.columnKey)),
    );
    const byKey = Object.fromEntries(rows.map((row) => [row.columnKey, row]));
    expect(Object.keys(byKey).sort()).toEqual(['c_id', 'c_ok', 'c_periodo', 'c_prazo', 'c_ust']);
    expect(byKey.c_ust?.vNum).toBe('42.5');
    expect(byKey.c_prazo?.vDate).toBe('2026-11-30');
    expect(byKey.c_periodo).toMatchObject({ vDate: '2026-11-01', vDateEnd: '2026-11-20' });
    expect(byKey.c_ok?.vBool).toBe(true);

    await withTenant(app.db, { tenantId: tenant.tenantId }, (tx) =>
      tx
        .update(items)
        .set({ values: { ...item.values, c_ust: { n: '10' } } })
        .where(eq(items.id, item.id)),
    );
    const updated = await withTenant(app.db, { tenantId: tenant.tenantId }, (tx) =>
      tx
        .select({ vNum: itemFieldIndex.vNum })
        .from(itemFieldIndex)
        .where(and(eq(itemFieldIndex.itemId, item.id), eq(itemFieldIndex.columnKey, 'c_ust'))),
    );
    expect(updated[0]?.vNum).toBe('10');
  });

  it('permite ordenar e filtrar por faixa usando a projeção', async () => {
    await insertItem('ust-baixo', { c_ust: { n: '1' } });
    await insertItem('ust-alto', { c_ust: { n: '999' } });
    const ordered = await withTenant(app.db, { tenantId: tenant.tenantId }, (tx) =>
      tx
        .select({ name: items.name, ust: itemFieldIndex.vNum })
        .from(items)
        .innerJoin(
          itemFieldIndex,
          and(eq(itemFieldIndex.itemId, items.id), eq(itemFieldIndex.columnKey, 'c_ust')),
        )
        .where(
          and(eq(items.boardId, tenant.boardId), sql`${itemFieldIndex.vNum} between 5 and 1000`),
        )
        .orderBy(asc(itemFieldIndex.vNum)),
    );
    expect(ordered.map((row) => row.name)).toEqual(['projetado', 'ust-alto']);
  });

  it('filtra por conteúdo JSONB (índice GIN)', async () => {
    const found = await withTenant(app.db, { tenantId: tenant.tenantId }, (tx) =>
      tx
        .select({ name: items.name })
        .from(items)
        .where(sql`${items.values} @> ${JSON.stringify({ c_ok: { checked: true } })}::jsonb`),
    );
    expect(found.map((row) => row.name)).toEqual(['projetado']);
  });

  it('limita subitens a um nível', async () => {
    const parent = await insertItem('pai');
    const child = await insertItem('filho', {}, { parentItemId: parent.id });
    expect(child.values.c_id).toBeUndefined();
    await expectPgError(insertItem('neto', {}, { parentItemId: child.id }), ['23514']);
  });

  it('impede item em grupo de outro board', async () => {
    const otherGroup = await withTenant(app.db, { tenantId: tenant.tenantId }, async (tx) => {
      const boardId = newId();
      await tx.insert(boards).values({
        id: boardId,
        tenantId: tenant.tenantId,
        workspaceId: tenant.workspaceId,
        name: 'Outro',
        position: 'a1',
      });
      const groupId = newId();
      await tx
        .insert(groups)
        .values({ id: groupId, tenantId: tenant.tenantId, boardId, name: 'G', position: 'a0' });
      return groupId;
    });
    await expectPgError(
      withTenant(app.db, { tenantId: tenant.tenantId }, (tx) =>
        tx.insert(items).values({
          tenantId: tenant.tenantId,
          boardId: tenant.boardId,
          groupId: otherGroup,
          name: 'x',
          position: 'z0',
        }),
      ),
      ['23503'],
    );
  });

  it('calcula dias úteis considerando feriados nacionais, estaduais e municipais', async () => {
    const calendarId = await withTenant(app.db, { tenantId: tenant.tenantId }, async (tx) => {
      const id = newId();
      await tx.insert(workCalendars).values({
        id,
        tenantId: tenant.tenantId,
        name: 'SP',
        stateCode: 'SP',
        cityIbgeCode: '3550308',
      });
      return id;
    });
    // Julho/2026 em São Paulo: 23 dias úteis menos 09/07 (Revolução Constitucionalista) = 22.
    const july = await withTenant(app.db, { tenantId: tenant.tenantId }, (tx) =>
      tx.execute<{ days: number }>(
        sql`select app.business_days_between(${calendarId}::uuid, '2026-07-01', '2026-07-31') as days`,
      ),
    );
    expect(july.rows[0]?.days).toBe(22);
    // Semana de Corpus Christi (04/06/2026): municipal em SP, ponto facultativo nacional.
    const june = await withTenant(app.db, { tenantId: tenant.tenantId }, (tx) =>
      tx.execute<{ days: number }>(
        sql`select app.business_days_between(${calendarId}::uuid, '2026-06-01', '2026-06-05') as days`,
      ),
    );
    expect(june.rows[0]?.days).toBe(4);
  });
});
