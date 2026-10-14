import type { RealtimeEvent, RealtimeEventType } from '@cube-track/shared';

import type { Item, Page } from '@/lib/api/types';
import type { ItemPages } from '@/realtime/apply';

export const BOARD_ID = '01a13ae4-2a52-72eb-8541-797447941656';

export function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: '01a13ae4-0000-7000-8000-000000000001',
    boardId: BOARD_ID,
    groupId: '01a13ae4-0000-7000-8000-0000000000aa',
    parentItemId: null,
    name: 'Item',
    position: 'a0',
    values: {},
    fieldVersions: {},
    version: 1,
    plannedStartDate: null,
    plannedEndDate: null,
    replannedStartDate: null,
    replannedEndDate: null,
    actualStartDate: null,
    actualEndDate: null,
    progress: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    archivedAt: null,
    redactedFields: [],
    ...overrides,
  };
}

export function pagesOf(...pages: Item[][]): ItemPages {
  return {
    pageParams: pages.map((_, index) => (index === 0 ? null : `cursor-${String(index)}`)),
    pages: pages.map(
      (data, index): Page<Item> => ({
        data,
        pageInfo: { nextCursor: null, hasNextPage: index < pages.length - 1 },
      }),
    ),
  };
}

let counter = 0;

export function makeEvent(
  type: RealtimeEventType,
  payload: unknown,
  overrides: Partial<RealtimeEvent> = {},
): RealtimeEvent {
  counter += 1;
  return {
    eventId: `event-${String(counter)}`,
    type,
    tenantId: '01a13ae4-0000-7000-8000-0000000000ff',
    scope: { boardId: BOARD_ID, itemId: null, userId: null, dashboardId: null },
    seq: null,
    actor: { kind: 'user', userId: '01a13ae4-0000-7000-8000-0000000000ee' },
    clientMutationId: null,
    occurredAt: '2026-10-01T12:00:00.000Z',
    payload: payload as RealtimeEvent['payload'],
    schemaVersion: 1,
    ...overrides,
  };
}
