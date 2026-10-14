import { newId } from '@cube-track/shared';
import { sql } from 'drizzle-orm';

import { createDatabase, withTenant, type Transaction } from '../client.js';
import { requireEnv } from '../env.js';
import { provisionTenant } from '../provisioning.js';
import { boards, columnDefinitions, groups, statusLabels, workspaces } from '../schema/index.js';

/**
 * Benchmark do modelo de colunas customizadas (ADR 0005/0020): cria um tenant descartável com
 * um board de N itens, mede consultas típicas de view e remove o tenant ao final.
 * Uso: pnpm --filter @cube-track/db db:bench [quantidade=50000]
 */
class RollbackBenchmark extends Error {}

const ITEM_COUNT = Number(process.argv[2] ?? 50_000);
const RUNS = 5;

async function measure(
  tx: Transaction,
  label: string,
  query: ReturnType<typeof sql>,
): Promise<void> {
  const timings: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const result = await tx.execute<{ 'QUERY PLAN': { 'Execution Time': number }[] }>(
      sql`explain (analyze, format json) ${query}`,
    );
    const plan = result.rows[0]?.['QUERY PLAN'][0];
    timings.push(plan?.['Execution Time'] ?? Number.NaN);
  }
  timings.sort((a, b) => a - b);
  const median = timings[Math.floor(RUNS / 2)] ?? Number.NaN;
  console.info(
    `${label.padEnd(58)} mediana ${median.toFixed(2)} ms (min ${(timings[0] ?? 0).toFixed(2)} ms)`,
  );
}

const handle = createDatabase(requireEnv('DATABASE_URL'), { max: 1 });
const tenantId = newId();
try {
  await withTenant(handle.db, { tenantId }, async (tx) => {
    await provisionTenant(tx, { id: tenantId, name: 'Benchmark', slug: `bench-${Date.now()}` });
    const workspaceId = newId();
    await tx
      .insert(workspaces)
      .values({ id: workspaceId, tenantId, name: 'Bench', position: 'a0' });
    const boardId = newId();
    await tx
      .insert(boards)
      .values({ id: boardId, tenantId, workspaceId, name: 'Board 50k', position: 'a0' });
    const groupIds = [newId(), newId(), newId()];
    await tx.insert(groups).values(
      groupIds.map((id, index) => ({
        id,
        tenantId,
        boardId,
        name: `G${index}`,
        position: `a${index}`,
      })),
    );
    const statusColumnId = newId();
    await tx.insert(columnDefinitions).values([
      {
        id: statusColumnId,
        tenantId,
        boardId,
        key: 'c_status',
        type: 'status',
        title: 'Status',
        position: 'a0',
      },
      { tenantId, boardId, key: 'c_ust', type: 'number', title: 'UST', position: 'a1' },
      { tenantId, boardId, key: 'c_prazo', type: 'date', title: 'Prazo', position: 'a2' },
      { tenantId, boardId, key: 'c_people', type: 'people', title: 'Responsáveis', position: 'a3' },
      { tenantId, boardId, key: 'c_text', type: 'text', title: 'Texto', position: 'a4' },
    ]);
    const labelIds = [newId(), newId(), newId(), newId()];
    await tx.insert(statusLabels).values(
      labelIds.map((id, index) => ({
        id,
        tenantId,
        columnId: statusColumnId,
        label: `S${index}`,
        color: '#00c875',
        position: `a${index}`,
      })),
    );
    const people = Array.from({ length: 20 }, () => newId());

    const started = performance.now();
    await tx.execute(sql`
      insert into items (tenant_id, board_id, group_id, name, position, values)
      select ${tenantId}::uuid, ${boardId}::uuid,
             (${sql.raw(`array['${groupIds.join("','")}']`)}::uuid[])[1 + g % 3],
             'Item ' || g,
             lpad(to_hex(g), 8, '0'),
             jsonb_build_object(
               'c_status', jsonb_build_object('labelId', (${sql.raw(`array['${labelIds.join("','")}']`)})[1 + g % 4]),
               'c_ust', jsonb_build_object('n', ((g * 7919) % 1000)::text),
               'c_prazo', jsonb_build_object('d', (date '2026-01-01' + (g % 365))::text),
               'c_people', jsonb_build_object('personIds', jsonb_build_array((${sql.raw(`array['${people.join("','")}']`)})[1 + g % 20]), 'teamIds', '[]'::jsonb),
               'c_text', jsonb_build_object('text', md5(g::text))
             )
      from generate_series(1, ${ITEM_COUNT}) g
    `);
    console.info(
      `Inseridos ${ITEM_COUNT} itens (com projeção por trigger) em ${((performance.now() - started) / 1000).toFixed(1)} s`,
    );
    await tx.execute(sql`analyze items`);
    await tx.execute(sql`analyze item_field_index`);

    const label = labelIds[1] ?? '';
    const person = people[3] ?? '';
    const group = groupIds[0] ?? '';
    await measure(
      tx,
      'Página de 100 por grupo e posição',
      sql`
      select id, name, values from items
      where board_id = ${boardId}::uuid and group_id = ${group}::uuid
        and archived_at is null and deleted_at is null and parent_item_id is null
      order by position limit 100`,
    );
    await measure(
      tx,
      'Filtro status (GIN @>) + página de 100',
      sql`
      select id, name from items
      where board_id = ${boardId}::uuid and values @> ${JSON.stringify({ c_status: { labelId: label } })}::jsonb
      order by position limit 100`,
    );
    await measure(
      tx,
      'Filtro pessoa (GIN @>) + ordenação por número + 100',
      sql`
      select i.id, f.v_num from items i
      join item_field_index f on f.item_id = i.id and f.column_key = 'c_ust'
      where i.board_id = ${boardId}::uuid and i.values @> ${JSON.stringify({ c_people: { personIds: [person] } })}::jsonb
      order by f.v_num desc, i.id limit 100`,
    );
    await measure(
      tx,
      'Ordenação por número (projeção) + cursor + 100',
      sql`
      select i.id, i.name, f.v_num from item_field_index f
      join items i on i.id = f.item_id
      where f.board_id = ${boardId}::uuid and f.column_key = 'c_ust' and (f.v_num, f.item_id) > (500, ${'00000000-0000-0000-0000-000000000000'}::uuid)
        and i.deleted_at is null
      order by f.v_num, f.item_id limit 100`,
    );
    await measure(
      tx,
      'Faixa de datas (projeção) + ordenação + 100',
      sql`
      select i.id from item_field_index f join items i on i.id = f.item_id
      where f.board_id = ${boardId}::uuid and f.column_key = 'c_prazo' and f.v_date between '2026-03-01' and '2026-03-31'
      order by f.v_date, f.item_id limit 100`,
    );
    await measure(
      tx,
      'Agregação: soma de UST por status (board inteiro)',
      sql`
      select i.values -> 'c_status' ->> 'labelId' as status, sum(f.v_num) from items i
      join item_field_index f on f.item_id = i.id and f.column_key = 'c_ust'
      where i.board_id = ${boardId}::uuid group by 1`,
    );
    await measure(
      tx,
      'Contagem por grupo (board inteiro)',
      sql`
      select group_id, count(*) from items where board_id = ${boardId}::uuid and deleted_at is null group by 1`,
    );
    throw new RollbackBenchmark();
  });
} catch (error) {
  if (!(error instanceof RollbackBenchmark)) throw error;
  console.info('Tenant de benchmark descartado (rollback).');
} finally {
  await handle.close();
}
