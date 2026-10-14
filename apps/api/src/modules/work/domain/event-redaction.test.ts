import type { BoardAccess, PrincipalAccess, RealtimeTransportMessage } from '@cube-track/shared';
import { describe, expect, it } from 'vitest';

import { redactEventFor } from './event-redaction.js';

const principal: PrincipalAccess = {
  userId: 'u1',
  tenantId: 't',
  kind: 'guest',
  tenantRoleId: 'r',
  tenantRoleKey: 'guest',
  tenantPermissions: [],
  teamIds: [],
};
const board = (itemScope: 'all' | 'assigned'): BoardAccess => ({
  boardId: 'b',
  workspaceId: 'w',
  permissions: ['board.read'],
  roleIds: [],
  itemScope,
  peopleColumnKeys: ['c_people'],
});

const message = (
  type: 'item.updated' | 'item.created',
  assigneeIds: string[],
): RealtimeTransportMessage => ({
  event: {
    eventId: 'e',
    type,
    tenantId: 't',
    scope: { boardId: 'b', itemId: 'i', userId: null, dashboardId: null },
    seq: 7,
    actor: { userId: 'u2', kind: 'user' },
    clientMutationId: 'm',
    occurredAt: '2026-10-14T00:00:00.000Z',
    payload:
      type === 'item.updated'
        ? {
            itemId: 'i',
            version: 2,
            changes: [
              { field: 'c_ust', kind: 'column', value: { n: '10' }, version: 2 },
              { field: 'c_status', kind: 'column', value: { labelId: 'x' }, version: 1 },
              { field: 'planned_end_date', kind: 'native', value: '2026-12-01', version: 1 },
            ],
          }
        : ({
            item: { values: { c_ust: { n: '1' }, c_status: {} }, plannedEndDate: '2026-12-01' },
          } as never),
    schemaVersion: 1,
  },
  routing: { assigneeIds },
});

const visibility = {
  hidden: new Set(['c_ust']),
  hiddenBindings: new Set(['item.planned_end_date']),
};

describe('redactEventFor', () => {
  it('remove mudanças de colunas e campos vinculados ocultos', () => {
    const result = redactEventFor(
      message('item.updated', ['u1']),
      principal,
      board('all'),
      visibility,
    );
    expect(
      (result.payload as { changes: { field: string }[] }).changes.map((change) => change.field),
    ).toEqual(['c_status']);
  });

  it('oculta valores no snapshot de item criado', () => {
    const result = redactEventFor(
      message('item.created', ['u1']),
      principal,
      board('all'),
      visibility,
    );
    const item = (result.payload as { item: { values: object; plannedEndDate: string | null } })
      .item;
    expect(item.values).toEqual({ c_status: {} });
    expect(item.plannedEndDate).toBeNull();
  });

  it('convidado com escopo "assigned" recebe apenas o avanço de sequência', () => {
    const result = redactEventFor(
      message('item.updated', ['u9']),
      principal,
      board('assigned'),
      visibility,
    );
    expect(result.type).toBe('sequence.skipped');
    expect(result.seq).toBe(7);
    expect(result.payload).toEqual({});
    expect(
      redactEventFor(message('item.updated', ['u1']), principal, board('assigned'), visibility)
        .type,
    ).toBe('item.updated');
  });

  it('sem acesso ao board, nada é revelado', () => {
    expect(redactEventFor(message('item.updated', ['u1']), principal, null, visibility).type).toBe(
      'sequence.skipped',
    );
  });
});
