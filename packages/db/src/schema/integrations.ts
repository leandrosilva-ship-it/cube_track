import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { integrationAuthKind, integrationProvider } from './_enums.js';
import { deletedAt, tenantFk, tenantTable } from './_helpers.js';
import { users } from './identity.js';
import { boards, items, workspaces } from './structure.js';

/**
 * App OAuth do PRÓPRIO tenant para Google Workspace/Microsoft 365 (Prompt 15, ADR 0056): client
 * id/secret cadastrados pela organização no Google Cloud Console/Azure AD (BYOK, nunca uma credencial
 * compartilhada da plataforma). Guardado à parte de `integration_connections` porque o app é cadastrado
 * UMA VEZ pelo admin do workspace (`integrations.manage`) e cada membro então consente
 * INDIVIDUALMENTE nesse mesmo app — `integration_connections` (por usuário) referencia implicitamente
 * este registro (mesmo `tenantId`+`workspaceId`+`provider`) na hora de montar a URL de autorização e
 * de trocar o código por tokens; não há FK direta porque a conexão sobrevive à troca do app (só a
 * autorização individual perde validade, exigindo reconexão).
 */
export const integrationApps = tenantTable(
  'integration_apps',
  {
    workspaceId: uuid('workspace_id').notNull(),
    provider: integrationProvider('provider').notNull(),
    clientId: text('client_id').notNull(),
    clientSecretCiphertext: text('client_secret_ciphertext').notNull(),
    /** Normalmente `${API_URL}/v1/integrations/:provider/callback` — guardado para auditoria/depuração,
     * nunca usado para decidir o redirect_uri de verdade (sempre recalculado a partir da config). */
    redirectUri: text('redirect_uri'),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('integration_apps', t.tenantId, t.workspaceId, workspaces),
    uniqueIndex('integration_apps_workspace_provider_key')
      .on(t.tenantId, t.workspaceId, t.provider)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * Integrações de terceiros (Prompt 15, ADR 0056) — toda credencial é BYOK. Google/Microsoft são OAuth
 * de verdade e a conexão é POR USUÁRIO (cada um consente individualmente no seu próprio
 * calendário/Drive/e-mail); Slack/Teams/GitHub/GitLab/Azure DevOps são só webhook (entrada ou saída)
 * e a conexão é do WORKSPACE inteiro (`userId` nulo) — ver `INTEGRATION_AUTH_KIND_BY_PROVIDER`
 * (packages/shared/src/integrations.ts).
 */
export const integrationConnections = tenantTable(
  'integration_connections',
  {
    workspaceId: uuid('workspace_id').notNull(),
    provider: integrationProvider('provider').notNull(),
    authKind: integrationAuthKind('auth_kind').notNull(),
    /** Só para `authKind = 'oauth'` — conexão pessoal (Google/Microsoft). Nulo nas de workspace inteiro. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    accessTokenCiphertext: text('access_token_ciphertext'),
    refreshTokenCiphertext: text('refresh_token_ciphertext'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    /** Só para `authKind = 'webhook_secret'` — segredo compartilhado para validar a assinatura do
     * webhook de ENTRADA (GitHub/GitLab/Azure DevOps/Slack) cifrado como qualquer outro segredo. */
    webhookSecretCiphertext: text('webhook_secret_ciphertext'),
    /** Só para Slack/Teams — URL do Incoming Webhook/Connector do canal (SAÍDA), cifrada (é, na
     * prática, um segredo: qualquer um com a URL posta no canal). */
    outboundWebhookUrlCiphertext: text('outbound_webhook_url_ciphertext'),
    /** Config livre por provedor (ex.: id do calendário padrão, canal padrão do Slack). */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('integration_connections', t.tenantId, t.workspaceId, workspaces),
    uniqueIndex('integration_connections_per_user_key')
      .on(t.tenantId, t.workspaceId, t.provider, t.userId)
      .where(sql`${t.deletedAt} is null and ${t.userId} is not null`),
    uniqueIndex('integration_connections_per_workspace_key')
      .on(t.tenantId, t.workspaceId, t.provider)
      .where(sql`${t.deletedAt} is null and ${t.userId} is null`),
    index('integration_connections_workspace_idx').on(t.tenantId, t.workspaceId),
  ],
);

/** Vínculo item ↔ evento de calendário externo (Google/Microsoft) — permite atualizar/excluir o
 * evento certo quando as datas do item mudam, e reconciliar mudanças feitas do lado do provedor. */
export const calendarSyncLinks = tenantTable(
  'calendar_sync_links',
  {
    itemId: uuid('item_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    externalEventId: text('external_event_id').notNull(),
    externalCalendarId: text('external_calendar_id').notNull(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantFk('calendar_sync_links', t.tenantId, t.itemId, items),
    tenantFk('calendar_sync_links', t.tenantId, t.connectionId, integrationConnections),
    uniqueIndex('calendar_sync_links_item_connection_key').on(t.itemId, t.connectionId),
  ],
);

/** Arquivo do Drive/OneDrive anexado por REFERÊNCIA (nunca baixado/reenviado ao nosso storage) — o
 * item guarda nome/ícone/link; abrir o arquivo sempre leva ao Drive/OneDrive do dono da conexão. */
export const externalFileLinks = tenantTable(
  'external_file_links',
  {
    itemId: uuid('item_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    externalFileId: text('external_file_id').notNull(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    mimeType: text('mime_type'),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('external_file_links', t.tenantId, t.itemId, items),
    tenantFk('external_file_links', t.tenantId, t.connectionId, integrationConnections),
    index('external_file_links_item_idx').on(t.itemId).where(sql`${t.deletedAt} is null`),
  ],
);

/** Vínculo commit/PR → item (GitHub/GitLab/Azure DevOps, somente leitura/trilha — nunca editável pela
 * UI): registra qual evento de qual repositório tocou qual item, para exibir no painel do item. */
export const devEventLinks = tenantTable(
  'dev_event_links',
  {
    itemId: uuid('item_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    boardId: uuid('board_id'),
    kind: text('kind').notNull(),
    repo: text('repo').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    authorName: text('author_name').notNull(),
  },
  (t) => [
    tenantFk('dev_event_links', t.tenantId, t.itemId, items),
    tenantFk('dev_event_links', t.tenantId, t.connectionId, integrationConnections),
    tenantFk('dev_event_links', t.tenantId, t.boardId, boards),
    index('dev_event_links_item_idx').on(t.itemId, t.createdAt),
  ],
);
