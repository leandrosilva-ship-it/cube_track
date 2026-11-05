import { schema, withTenant, type DatabaseHandle, type Transaction } from '@cube-track/db';
import {
  buildGoogleCalendarEventBody,
  buildMicrosoftCalendarEventBody,
  DomainEventJobSchema,
  MICROSOFT_OAUTH_SCOPES,
  type ItemFieldChange,
} from '@cube-track/shared';
import { decryptSecret, encryptSecret } from '@cube-track/shared/crypto';
import type { Job } from 'bullmq';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { Logger } from '../logger.js';
import { runAsSystem } from '../system-tx.js';

const { items, boards, columnDefinitions, integrationConnections, integrationApps, calendarSyncLinks } = schema;

type ConnectionRow = typeof integrationConnections.$inferSelect;
type CalendarProvider = 'google' | 'microsoft';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GOOGLE_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const MICROSOFT_EVENTS_URL = 'https://graph.microsoft.com/v1.0/me/events';
const REFRESH_MARGIN_MS = 60_000;

/** Campos de data cuja mudança (`item.updated`) dispara a sincronização para o calendário (ADR 0056).
 * `item.created` sempre é considerado (sem lista de `changes` para checar). */
const DATE_FIELDS: ReadonlySet<string> = new Set([
  'plannedStartDate',
  'plannedEndDate',
  'replannedStartDate',
  'replannedEndDate',
]);

export interface CalendarSyncDeps {
  database: DatabaseHandle;
  redis: Redis;
  encryptionKey: string;
  appUrl: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

function subtractOneDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Renova o `access_token` quando vencido (ou perto disso) — mesma lógica de `ensureFreshAccessToken`
 * da API (`GoogleMicrosoftService`), reimplementada aqui sem NestJS DI (processo separado). */
async function ensureFreshAccessToken(
  tx: Transaction,
  connection: ConnectionRow,
  encryptionKey: string,
  doFetch: typeof fetch,
): Promise<string | null> {
  const freshEnough =
    connection.tokenExpiresAt !== null && connection.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS;
  if (freshEnough && connection.accessTokenCiphertext !== null)
    return decryptSecret(connection.accessTokenCiphertext, encryptionKey);
  if (connection.refreshTokenCiphertext === null) return null;
  const [app] = await tx
    .select()
    .from(integrationApps)
    .where(
      and(
        eq(integrationApps.workspaceId, connection.workspaceId),
        eq(integrationApps.provider, connection.provider),
        isNull(integrationApps.deletedAt),
      ),
    );
  if (app === undefined) return null;
  const provider = connection.provider as CalendarProvider;
  const tokenUrl = provider === 'google' ? GOOGLE_TOKEN_URL : MICROSOFT_TOKEN_URL;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: decryptSecret(connection.refreshTokenCiphertext, encryptionKey),
    client_id: app.clientId,
    client_secret: decryptSecret(app.clientSecretCiphertext, encryptionKey),
    ...(provider === 'microsoft' ? { scope: MICROSOFT_OAUTH_SCOPES } : {}),
  });
  const response = await doFetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const json = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof json.access_token !== 'string' || typeof json.expires_in !== 'number') return null;
  await tx
    .update(integrationConnections)
    .set({
      accessTokenCiphertext: encryptSecret(json.access_token, encryptionKey),
      tokenExpiresAt: new Date(Date.now() + json.expires_in * 1_000),
    })
    .where(eq(integrationConnections.id, connection.id));
  return json.access_token;
}

/**
 * Direção item → calendário (ADR 0056), fila `calendar-sync` (consome `item.created`/`item.updated` —
 * `EVENT_CONSUMERS`, `packages/shared/src/jobs.ts`): para cada pessoa atribuída ao item (coluna
 * `people`) que tenha uma conexão OAuth Google/Microsoft ativa no workspace do board, cria/atualiza o
 * evento de dia inteiro no calendário dela e registra o vínculo em `calendar_sync_links`. Datas
 * removidas do item excluem o evento (melhor esforço — falha ao excluir no provedor não impede a
 * remoção do vínculo local, para não ficar reprocessando um evento que o usuário já apagou manualmente).
 */
export function calendarSyncPushProcessor(deps: CalendarSyncDeps) {
  const doFetch = deps.fetchImpl ?? fetch;
  return async function pushCalendarSync(job: Job): Promise<{ synced: number }> {
    const event = DomainEventJobSchema.parse(job.data);
    if (event.type !== 'item.created' && event.type !== 'item.updated') return { synced: 0 };
    if (event.boardId === null || event.itemId === null) return { synced: 0 };
    if (event.type === 'item.updated') {
      const changes = Array.isArray(event.payload.changes)
        ? (event.payload.changes as { field?: unknown }[])
        : [];
      const touchesDates = changes.some(
        (change) => typeof change.field === 'string' && DATE_FIELDS.has(change.field),
      );
      if (!touchesDates) return { synced: 0 };
    }

    const itemId = event.itemId;
    let synced = 0;
    await withTenant(deps.database.db, { tenantId: event.tenantId, userId: null }, async (tx) => {
      const [item] = await tx
        .select({
          id: items.id,
          boardId: items.boardId,
          name: items.name,
          values: items.values,
          plannedStartDate: items.plannedStartDate,
          plannedEndDate: items.plannedEndDate,
          replannedStartDate: items.replannedStartDate,
          replannedEndDate: items.replannedEndDate,
        })
        .from(items)
        .where(eq(items.id, itemId));
      if (item === undefined) return;
      const [board] = await tx
        .select({ workspaceId: boards.workspaceId })
        .from(boards)
        .where(eq(boards.id, item.boardId));
      if (board === undefined) return;

      const peopleColumns = await tx
        .select({ key: columnDefinitions.key })
        .from(columnDefinitions)
        .where(
          and(
            eq(columnDefinitions.boardId, item.boardId),
            eq(columnDefinitions.type, 'people'),
            isNull(columnDefinitions.deletedAt),
          ),
        );
      const assigneeIds = new Set<string>();
      for (const column of peopleColumns) {
        const value = item.values[column.key] as { personIds?: unknown } | undefined;
        if (Array.isArray(value?.personIds))
          for (const id of value.personIds) if (typeof id === 'string') assigneeIds.add(id);
      }
      if (assigneeIds.size === 0) return;

      const connections = await tx
        .select()
        .from(integrationConnections)
        .where(
          and(
            eq(integrationConnections.workspaceId, board.workspaceId),
            inArray(integrationConnections.provider, ['google', 'microsoft']),
            eq(integrationConnections.authKind, 'oauth'),
            eq(integrationConnections.isActive, true),
            isNull(integrationConnections.deletedAt),
            inArray(integrationConnections.userId, [...assigneeIds]),
          ),
        );
      if (connections.length === 0) return;

      const startDate = item.replannedStartDate ?? item.plannedStartDate;
      const endDate = item.replannedEndDate ?? item.plannedEndDate;

      for (const connection of connections) {
        const [existingLink] = await tx
          .select()
          .from(calendarSyncLinks)
          .where(and(eq(calendarSyncLinks.itemId, item.id), eq(calendarSyncLinks.connectionId, connection.id)));

        if (startDate === null || endDate === null) {
          if (existingLink === undefined) continue;
          const accessToken = await ensureFreshAccessToken(tx, connection, deps.encryptionKey, doFetch);
          if (accessToken !== null) {
            const provider = connection.provider as CalendarProvider;
            const baseUrl = provider === 'google' ? GOOGLE_EVENTS_URL : MICROSOFT_EVENTS_URL;
            await doFetch(`${baseUrl}/${existingLink.externalEventId}`, {
              method: 'DELETE',
              headers: { authorization: `Bearer ${accessToken}` },
            }).catch(() => undefined);
          }
          await tx.delete(calendarSyncLinks).where(eq(calendarSyncLinks.id, existingLink.id));
          continue;
        }

        const accessToken = await ensureFreshAccessToken(tx, connection, deps.encryptionKey, doFetch);
        if (accessToken === null) {
          deps.logger.warn(
            { connectionId: connection.id },
            'Conexão de calendário sem access_token válido — sincronização ignorada',
          );
          continue;
        }
        const provider = connection.provider as CalendarProvider;
        const eventInput = {
          title: item.name,
          description: null,
          startDate,
          endDate,
          url: `${deps.appUrl}/items/${item.id}`,
        };
        const body =
          provider === 'google' ? buildGoogleCalendarEventBody(eventInput) : buildMicrosoftCalendarEventBody(eventInput);
        const baseUrl = provider === 'google' ? GOOGLE_EVENTS_URL : MICROSOFT_EVENTS_URL;
        const url = existingLink === undefined ? baseUrl : `${baseUrl}/${existingLink.externalEventId}`;
        const method = existingLink === undefined ? 'POST' : 'PATCH';
        const response = await doFetch(url, {
          method,
          headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          deps.logger.warn(
            { connectionId: connection.id, status: response.status },
            'Falha ao sincronizar evento de calendário',
          );
          continue;
        }
        const json = (await response.json()) as { id?: unknown };
        const externalEventId = typeof json.id === 'string' ? json.id : (existingLink?.externalEventId ?? null);
        if (externalEventId === null) continue;
        if (existingLink === undefined) {
          await tx.insert(calendarSyncLinks).values({
            tenantId: event.tenantId,
            itemId: item.id,
            connectionId: connection.id,
            externalEventId,
            externalCalendarId: 'primary',
          });
        } else {
          await tx
            .update(calendarSyncLinks)
            .set({ externalEventId, lastSyncedAt: new Date() })
            .where(eq(calendarSyncLinks.id, existingLink.id));
        }
        synced += 1;
      }
    });
    return { synced };
  };
}

interface RemoteEvent {
  id: string;
  cancelled: boolean;
  start: string | null;
  end: string | null;
}

async function listRemoteEvents(
  provider: CalendarProvider,
  accessToken: string,
  updatedMinIso: string,
  doFetch: typeof fetch,
): Promise<RemoteEvent[]> {
  if (provider === 'google') {
    const url = `${GOOGLE_EVENTS_URL}?updatedMin=${encodeURIComponent(updatedMinIso)}&showDeleted=true&singleEvents=true`;
    const response = await doFetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return [];
    const json = (await response.json()) as {
      items?: { id?: unknown; status?: unknown; start?: { date?: unknown }; end?: { date?: unknown } }[];
    };
    return (json.items ?? []).map((item) => ({
      id: String(item.id),
      cancelled: item.status === 'cancelled',
      start: typeof item.start?.date === 'string' ? item.start.date : null,
      end: typeof item.end?.date === 'string' ? subtractOneDay(item.end.date) : null,
    }));
  }
  // Microsoft Graph: uma listagem simples não devolve itens excluídos (precisaria de delta query,
  // `/me/events/delta` — fora de escopo nesta entrega; documentado como limitação conhecida: a exclusão
  // de um evento feita diretamente no Outlook só é percebida aqui se o Graph ainda listar o evento com
  // outro status, o que normalmente não acontece. A reconciliação de DATA MOVIDA funciona normalmente).
  const filter = `lastModifiedDateTime ge ${updatedMinIso}`;
  const url = `${MICROSOFT_EVENTS_URL}?$filter=${encodeURIComponent(filter)}`;
  const response = await doFetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return [];
  const json = (await response.json()) as {
    value?: { id?: unknown; start?: { dateTime?: unknown }; end?: { dateTime?: unknown } }[];
  };
  return (json.value ?? []).map((item) => ({
    id: String(item.id),
    cancelled: false,
    start: typeof item.start?.dateTime === 'string' ? item.start.dateTime.slice(0, 10) : null,
    end: typeof item.end?.dateTime === 'string' ? subtractOneDay(item.end.dateTime.slice(0, 10)) : null,
  }));
}

export interface CalendarSyncPeriodicOutcome {
  connectionId: string;
  reconciled: number;
}

/**
 * Direção calendário → item (ADR 0056), rotina `calendar-sync-periodic` (`MAINTENANCE_SCHEDULE`): para
 * cada conexão OAuth Google/Microsoft ativa, lista eventos alterados desde `metadata.lastSyncedAt`
 * (abordagem mais simples e correta pedida: `updatedMin`/equivalente desde a última sincronização, sem
 * delta query completa) e reconcilia com `calendar_sync_links` — evento excluído no provedor zera as
 * datas do item; evento movido atualiza as datas — sempre pela unidade de trabalho do sistema
 * (`runAsSystem`, auditoria + outbox + tempo real), nunca um UPDATE SQL cru.
 */
export function createCalendarSyncPeriodic(deps: CalendarSyncDeps) {
  const doFetch = deps.fetchImpl ?? fetch;
  return async function runCalendarSyncPeriodic(): Promise<{ outcomes: CalendarSyncPeriodicOutcome[] }> {
    // `integration_connections` tem RLS: o papel da aplicação não lista conexões entre tenants direto
    // (mesmo padrão de app.contract_alert_candidates()/app.sla_tracker_alerts(), migração 0032) — a
    // função SECURITY DEFINER só devolve o par (tenant, id); a linha completa é lida abaixo já dentro
    // do contexto do tenant certo (RLS normal).
    const candidates = await deps.database.db.execute<{ tenant_id: string; id: string }>(
      sql`select * from app.active_oauth_calendar_connections()`,
    );
    const outcomes: CalendarSyncPeriodicOutcome[] = [];
    for (const candidate of candidates.rows) {
      try {
        const connection = await withTenant(
          deps.database.db,
          { tenantId: candidate.tenant_id, userId: null },
          async (tx) => {
            const [row] = await tx.select().from(integrationConnections).where(eq(integrationConnections.id, candidate.id));
            return row ?? null;
          },
        );
        if (connection === null) continue;
        const reconciled = await reconcileConnection(deps, connection, doFetch);
        outcomes.push({ connectionId: connection.id, reconciled });
      } catch (error) {
        deps.logger.error(
          { connectionId: candidate.id, err: error },
          'Falha ao reconciliar calendário desta conexão — seguindo para as demais',
        );
      }
    }
    return { outcomes };
  };
}

async function reconcileConnection(
  deps: CalendarSyncDeps,
  connection: ConnectionRow,
  doFetch: typeof fetch,
): Promise<number> {
  const lastSyncedAt =
    typeof connection.metadata.lastSyncedAt === 'string'
      ? connection.metadata.lastSyncedAt
      : new Date(Date.now() - 24 * 3_600_000).toISOString();
  const now = new Date().toISOString();

  const { accessToken, links } = await withTenant(
    deps.database.db,
    { tenantId: connection.tenantId, userId: null },
    async (tx) => {
      const token = await ensureFreshAccessToken(tx, connection, deps.encryptionKey, doFetch);
      const linkRows = await tx
        .select()
        .from(calendarSyncLinks)
        .where(eq(calendarSyncLinks.connectionId, connection.id));
      return { accessToken: token, links: linkRows };
    },
  );
  if (accessToken === null || links.length === 0) {
    await withTenant(deps.database.db, { tenantId: connection.tenantId, userId: null }, (tx) =>
      tx
        .update(integrationConnections)
        .set({ metadata: { ...connection.metadata, lastSyncedAt: now } })
        .where(eq(integrationConnections.id, connection.id)),
    );
    return 0;
  }

  const remoteEvents = await listRemoteEvents(connection.provider as CalendarProvider, accessToken, lastSyncedAt, doFetch);
  const byId = new Map(remoteEvents.map((remote) => [remote.id, remote]));
  let reconciled = 0;

  await runAsSystem(
    deps.database,
    deps.redis,
    connection.tenantId,
    { kind: 'automation', causationId: null, depth: 0, correlationId: `calendar-sync-periodic:${connection.id}` },
    async (unit) => {
      for (const link of links) {
        const remote = byId.get(link.externalEventId);
        if (remote === undefined) continue; // não mudou desde a última sincronização
        const [item] = await unit.tx
          .select({
            id: items.id,
            boardId: items.boardId,
            version: items.version,
            fieldVersions: items.fieldVersions,
            plannedStartDate: items.plannedStartDate,
            plannedEndDate: items.plannedEndDate,
            replannedStartDate: items.replannedStartDate,
            replannedEndDate: items.replannedEndDate,
          })
          .from(items)
          .where(eq(items.id, link.itemId));
        if (item === undefined) {
          await unit.tx.delete(calendarSyncLinks).where(eq(calendarSyncLinks.id, link.id));
          continue;
        }
        const replanned = item.replannedStartDate !== null || item.replannedEndDate !== null;
        const startField = replanned ? ('replannedStartDate' as const) : ('plannedStartDate' as const);
        const endField = replanned ? ('replannedEndDate' as const) : ('plannedEndDate' as const);
        const newStart = remote.cancelled ? null : remote.start;
        const newEnd = remote.cancelled ? null : remote.end;
        if (item[startField] === newStart && item[endField] === newEnd) {
          if (remote.cancelled) await unit.tx.delete(calendarSyncLinks).where(eq(calendarSyncLinks.id, link.id));
          continue;
        }
        const fieldVersions = { ...item.fieldVersions };
        const changes: ItemFieldChange[] = [];
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const [field, value] of [
          [startField, newStart],
          [endField, newEnd],
        ] as const) {
          if (item[field] === value) continue;
          fieldVersions[field] = (fieldVersions[field] ?? 0) + 1;
          changes.push({ field, kind: 'native', value, version: fieldVersions[field] });
          before[field] = item[field];
          after[field] = value;
        }
        if (changes.length === 0) continue;
        const [updated] = await unit.tx
          .update(items)
          .set({ [startField]: newStart, [endField]: newEnd, fieldVersions, version: item.version + 1 })
          .where(eq(items.id, item.id))
          .returning({ version: items.version });
        await unit.activity({
          boardId: item.boardId,
          itemId: item.id,
          action: 'item.calendar_reconciled',
          columnKey: startField,
          oldValue: before[startField],
          newValue: after[startField],
        });
        await unit.audit({
          action: 'item.calendar_reconciled',
          entityType: 'item',
          entityId: item.id,
          before,
          after,
          metadata: { connectionId: connection.id, externalEventId: link.externalEventId, cancelled: remote.cancelled },
        });
        await unit.emit({
          type: 'item.updated',
          aggregateType: 'item',
          aggregateId: item.id,
          boardId: item.boardId,
          itemId: item.id,
          payload: { itemId: item.id, version: updated?.version ?? item.version + 1, changes },
        });
        if (remote.cancelled) await unit.tx.delete(calendarSyncLinks).where(eq(calendarSyncLinks.id, link.id));
        else await unit.tx.update(calendarSyncLinks).set({ lastSyncedAt: new Date() }).where(eq(calendarSyncLinks.id, link.id));
        reconciled += 1;
      }
    },
  );

  await withTenant(deps.database.db, { tenantId: connection.tenantId, userId: null }, (tx) =>
    tx
      .update(integrationConnections)
      .set({ metadata: { ...connection.metadata, lastSyncedAt: now } })
      .where(eq(integrationConnections.id, connection.id)),
  );
  return reconciled;
}
