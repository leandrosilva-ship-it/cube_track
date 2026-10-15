import { defaultStatusLabels, initialPositions, newId, positionsBetween } from '@cube-track/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { withTenant, type Database } from '../client.js';
import {
  boards,
  columnDefinitions,
  groups,
  memberships,
  statusLabels,
  views,
  workspaces,
} from '../schema/index.js';
import { DEMO_TENANT_ID } from './context.js';

export const LARGE_BOARD_NAME = 'Carga — 50 mil itens';

const GROUP_COUNT = 10;
const BATCH = 5_000;

/**
 * Board de carga para os critérios de desempenho (Tabela com 50 mil itens, k6): status, pessoas,
 * UST, prazo, texto e tags, com valores determinísticos distribuídos por 10 grupos. Idempotente.
 */
export async function seedLargeBoard(
  db: Database,
  itemCount = 50_000,
): Promise<{ boardId: string; created: boolean }> {
  return withTenant(db, { tenantId: DEMO_TENANT_ID }, async (tx) => {
    const [existing] = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.name, LARGE_BOARD_NAME), isNull(boards.deletedAt)));
    if (existing !== undefined) return { boardId: existing.id, created: false };
    const [workspace] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .orderBy(workspaces.position)
      .limit(1);
    if (workspace === undefined)
      throw new Error('Workspace de demonstração ausente (rode db:seed antes).');
    const people = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.kind, 'member'), isNull(memberships.deletedAt)));
    const boardId = newId();
    await tx.insert(boards).values({
      id: boardId,
      tenantId: DEMO_TENANT_ID,
      workspaceId: workspace.id,
      name: LARGE_BOARD_NAME,
      description: 'Board de carga para medir rolagem e filtros com 50 mil itens.',
      icon: 'gauge',
      settings: { statusColumnKey: 'c_status' },
      position: 'zz',
    });
    const groupIds = Array.from({ length: GROUP_COUNT }, () => newId());
    const groupPositions = initialPositions(GROUP_COUNT);
    const palette = [
      '#579bfc',
      '#a25ddc',
      '#00c875',
      '#fdab3d',
      '#e2445c',
      '#037f4c',
      '#0086c0',
      '#9cd326',
      '#ff642e',
      '#784bd1',
    ];
    await tx.insert(groups).values(
      groupIds.map((id, index) => ({
        id,
        tenantId: DEMO_TENANT_ID,
        boardId,
        name: `Lote ${String(index + 1).padStart(2, '0')}`,
        color: palette[index] ?? '#579bfc',
        position: groupPositions[index] ?? 'a0',
      })),
    );
    const statusColumnId = newId();
    const specs = [
      {
        id: statusColumnId,
        key: 'c_status',
        type: 'status',
        title: 'Status',
        width: 140,
        settings: {},
      },
      {
        id: newId(),
        key: 'c_owner',
        type: 'people',
        title: 'Responsável',
        width: 140,
        settings: {},
      },
      {
        id: newId(),
        key: 'c_ust',
        type: 'number',
        title: 'UST',
        width: 110,
        settings: { unit: 'UST', unitPosition: 'suffix', decimals: 2, aggregate: 'sum' },
      },
      { id: newId(), key: 'c_prazo', type: 'date', title: 'Prazo', width: 130, settings: {} },
      {
        id: newId(),
        key: 'c_texto',
        type: 'text',
        title: 'Descrição curta',
        width: 220,
        settings: {},
      },
      { id: newId(), key: 'c_tags', type: 'tags', title: 'Tags', width: 160, settings: {} },
    ];
    const columnPositions = initialPositions(specs.length);
    await tx.insert(columnDefinitions).values(
      specs.map((spec, index) => ({
        ...spec,
        tenantId: DEMO_TENANT_ID,
        boardId,
        position: columnPositions[index] ?? 'a0',
      })),
    );
    const labels = defaultStatusLabels('pt-BR');
    const labelIds = labels.map(() => newId());
    const labelPositions = initialPositions(labels.length);
    await tx.insert(statusLabels).values(
      labels.map((label, index) => ({
        id: labelIds[index],
        tenantId: DEMO_TENANT_ID,
        columnId: statusColumnId,
        label: label.label,
        color: label.color,
        category: label.category,
        position: labelPositions[index] ?? 'a0',
      })),
    );
    await tx.insert(views).values({
      tenantId: DEMO_TENANT_ID,
      boardId,
      name: 'Tabela principal',
      type: 'table',
      isDefault: true,
      position: 'a0',
    });
    const perGroup = Math.ceil(itemCount / GROUP_COUNT);
    const positions = positionsBetween(null, null, perGroup);
    const peopleIds = people.map((person) => person.userId);
    for (let offset = 0; offset < itemCount; offset += BATCH) {
      const count = Math.min(BATCH, itemCount - offset);
      // Valores determinísticos a partir do número do item (n): distribuição estável entre execuções.
      await tx.execute(sql`
        insert into items (tenant_id, board_id, group_id, name, position, values, planned_end_date)
        select
          ${DEMO_TENANT_ID}::uuid,
          ${boardId}::uuid,
          (string_to_array(${groupIds.join(',')}, ',')::uuid[])[(n % ${GROUP_COUNT}) + 1],
          'Demanda ' || lpad(n::text, 5, '0'),
          (string_to_array(${positions.join(',')}, ',')::text[])[(n / ${GROUP_COUNT}) + 1],
          jsonb_build_object(
            'c_status', jsonb_build_object('labelId', (string_to_array(${labelIds.join(',')}, ',')::text[])[(n % ${labelIds.length}) + 1]),
            'c_owner', jsonb_build_object(
              'personIds', jsonb_build_array((string_to_array(${peopleIds.join(',')}, ',')::text[])[(n % ${Math.max(peopleIds.length, 1)}) + 1]),
              'teamIds', '[]'::jsonb),
            'c_ust', jsonb_build_object('n', ((n % 97) * 1.25)::numeric(10,2)::text),
            'c_prazo', jsonb_build_object('d', (date '2026-01-01' + (n % 365))::text),
            'c_texto', jsonb_build_object('text', 'Item de carga número ' || n),
            'c_tags', jsonb_build_object('tags', jsonb_build_array('lote-' || (n % ${GROUP_COUNT}), 'carga'))
          ),
          date '2026-01-01' + (n % 365)
        from generate_series(${offset}::int, ${offset + count - 1}::int) as n`);
    }
    return { boardId, created: true };
  });
}
