import {
  isAssigned,
  type BoardAccess,
  type ItemFieldChange,
  type PrincipalAccess,
  type RealtimeEvent,
  type RealtimeTransportMessage,
} from '@cube-track/shared';

import {
  NATIVE_FIELD_BINDINGS,
  redactValues,
  type ColumnVisibility,
  type NativeField,
} from './item.js';

const NATIVE_SNAPSHOT_FIELDS: NativeField[] = [
  'plannedStartDate',
  'plannedEndDate',
  'replannedStartDate',
  'replannedEndDate',
  'actualStartDate',
  'actualEndDate',
  'progress',
];

const FIELD_TO_SNAPSHOT: Record<string, NativeField> = {
  planned_start_date: 'plannedStartDate',
  planned_end_date: 'plannedEndDate',
  replanned_start_date: 'replannedStartDate',
  replanned_end_date: 'replannedEndDate',
  actual_start_date: 'actualStartDate',
  actual_end_date: 'actualEndDate',
};

function skipped(event: RealtimeEvent): RealtimeEvent<'sequence.skipped'> {
  return { ...event, type: 'sequence.skipped', payload: {}, clientMutationId: null };
}

/**
 * Prepara um evento de board para um destinatário: aplica o escopo de itens (convidados veem só
 * itens atribuídos) e remove valores de colunas ocultas. Usado no fan-out WebSocket e no replay REST,
 * garantindo a mesma regra de leitura de REST/GraphQL.
 */
export function redactEventFor(
  message: RealtimeTransportMessage,
  principal: PrincipalAccess,
  board: BoardAccess | null,
  visibility: ColumnVisibility,
): RealtimeEvent {
  const { event, routing } = message;
  if (event.scope.boardId === null) return event;
  if (board === null) return skipped(event);
  const isItemEvent =
    event.type === 'item.created' || event.type === 'item.updated' || event.type === 'item.deleted';
  if (isItemEvent && board.itemScope === 'assigned') {
    const ids = routing.assigneeIds ?? [];
    const pseudoItem = {
      id: event.scope.itemId ?? '',
      values: { __assignees: { personIds: ids, teamIds: ids } },
    };
    if (!isAssigned(principal, { ...board, peopleColumnKeys: ['__assignees'] }, pseudoItem))
      return skipped(event);
  }
  switch (event.type) {
    case 'item.created': {
      const payload = event.payload as RealtimeEvent<'item.created'>['payload'];
      const item = { ...payload.item, values: redactValues(payload.item.values, visibility) };
      for (const field of NATIVE_SNAPSHOT_FIELDS) {
        if (visibility.hiddenBindings.has(NATIVE_FIELD_BINDINGS[field])) item[field] = null;
      }
      return { ...event, payload: { item } };
    }
    case 'item.updated': {
      const payload = event.payload as RealtimeEvent<'item.updated'>['payload'];
      const changes = payload.changes.filter((change: ItemFieldChange) => {
        if (change.kind === 'column') return !visibility.hidden.has(change.field);
        const snapshotField =
          FIELD_TO_SNAPSHOT[change.field] ??
          (change.field in NATIVE_FIELD_BINDINGS ? (change.field as NativeField) : undefined);
        return (
          snapshotField === undefined ||
          !visibility.hiddenBindings.has(NATIVE_FIELD_BINDINGS[snapshotField])
        );
      });
      return { ...event, payload: { ...payload, changes } };
    }
    case 'column.updated':
    case 'column.created':
    case 'column.deleted': {
      const payload = event.payload as { key: string };
      return visibility.hidden.has(payload.key) ? skipped(event) : event;
    }
    default:
      return event;
  }
}
