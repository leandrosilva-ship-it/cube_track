import { Inject, Injectable } from '@nestjs/common';
import { schema, withTenant, type DatabaseHandle } from '@cube-track/db';
import { decryptSecret, encryptSecret } from '@cube-track/shared/crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { randomToken } from '../../../core/crypto/secrets.js';
import { APP_DB } from '../../../core/database/tokens.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { REDIS } from '../../../core/redis/redis.module.js';
import { AccessService } from '../../access/application/access.service.js';
import {
  OAUTH_CONNECTION_CLIENT,
  type OAuthConnectionClient,
  type OAuthConnectionProvider,
} from '../infrastructure/oauth-connection.client.js';

const { integrationApps, integrationConnections, externalFileLinks, items } = schema;

const STATE_TTL_SECONDS = 600;
const REFRESH_MARGIN_MS = 60_000;

interface StoredOAuthState {
  tenantId: string;
  userId: string;
  workspaceId: string;
  provider: OAuthConnectionProvider;
  emailToItemEnabled: boolean;
}

export interface ExternalFileLinkDto {
  id: string;
  itemId: string;
  connectionId: string;
  externalFileId: string;
  name: string;
  url: string;
  mimeType: string | null;
  createdAt: string;
}

function toExternalFileLinkDto(row: typeof externalFileLinks.$inferSelect): ExternalFileLinkDto {
  return {
    id: row.id,
    itemId: row.itemId,
    connectionId: row.connectionId,
    externalFileId: row.externalFileId,
    name: row.name,
    url: row.url,
    mimeType: row.mimeType,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Google Workspace/Microsoft 365 (ADR 0056) — única integração desta entrega com OAuth de verdade.
 *
 * **Onde ficam as credenciais do app OAuth do tenant**: `integration_apps` (packages/db/src/schema/
 * integrations.ts), chaveada por `(tenantId, workspaceId, provider)` — DECISÃO DE DESIGN: o app
 * (client id/secret do Google Cloud Console/Azure AD) é cadastrado UMA VEZ pelo admin do workspace e
 * reaproveitado por toda conexão pessoal seguinte do mesmo provedor nesse workspace; não cabia dentro
 * de `integration_connections.metadata` porque metadata é por LINHA (por usuário, para OAuth) e o app é
 * um dado de workspace inteiro — colocar nele faria o app "pertencer" à primeira pessoa a conectar e
 * sumir se ela desconectasse.
 *
 * **Como o usuário que iniciou atravessa o callback**: o callback (`GET /v1/integrations/:provider/
 * callback`) é uma navegação pública do navegador (redirect do Google/Microsoft) — mirra o login OAuth
 * já existente (`IdentityModule`/`AuthService.startOAuth`/`completeOAuth`): o `state` é um token opaco
 * guardado no Redis (`integration:oauth:state:<state>`, TTL 10 min, apagado no primeiro uso) com
 * `tenantId`+`userId`+`workspaceId`+`provider` embutidos — nunca dependendo do cookie de sessão
 * sobreviver ao redirect entre domínios.
 */
@Injectable()
export class GoogleMicrosoftService {
  constructor(
    @Inject(APP_DB) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(OAUTH_CONNECTION_CLIENT) private readonly oauthClient: OAuthConnectionClient,
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  private redirectUri(provider: OAuthConnectionProvider): string {
    return `${this.config.API_URL}/v1/integrations/${provider}/callback`;
  }

  async connect(
    user: AuthPrincipal,
    workspaceId: string,
    provider: OAuthConnectionProvider,
    input: { clientId: string; clientSecret: string; emailToItemEnabled: boolean },
  ): Promise<{ authorizationUrl: string }> {
    await this.access.assert(user, 'integrations.manage', { type: 'workspace', id: workspaceId });
    const [existingApp] = await this.runner.tx
      .select({ id: integrationApps.id })
      .from(integrationApps)
      .where(
        and(
          eq(integrationApps.tenantId, user.tenantId),
          eq(integrationApps.workspaceId, workspaceId),
          eq(integrationApps.provider, provider),
          isNull(integrationApps.deletedAt),
        ),
      );
    const redirectUri = this.redirectUri(provider);
    const clientSecretCiphertext = encryptSecret(input.clientSecret, this.config.ENCRYPTION_KEY);
    if (existingApp === undefined) {
      await this.runner.tx.insert(integrationApps).values({
        tenantId: user.tenantId,
        workspaceId,
        provider,
        clientId: input.clientId,
        clientSecretCiphertext,
        redirectUri,
        createdBy: user.userId,
      });
    } else {
      await this.runner.tx
        .update(integrationApps)
        .set({ clientId: input.clientId, clientSecretCiphertext, redirectUri })
        .where(eq(integrationApps.id, existingApp.id));
    }
    this.events.recordChange({
      action: 'integration_app.upsert',
      entityType: 'integration_app',
      entityId: existingApp?.id ?? null,
      after: { workspaceId, provider },
    });

    const state = randomToken(24);
    const stored: StoredOAuthState = {
      tenantId: user.tenantId,
      userId: user.userId,
      workspaceId,
      provider,
      emailToItemEnabled: input.emailToItemEnabled,
    };
    await this.redis.set(
      `integration:oauth:state:${state}`,
      JSON.stringify(stored),
      'EX',
      STATE_TTL_SECONDS,
    );
    return {
      authorizationUrl: this.oauthClient.authorizationUrl(provider, {
        clientId: input.clientId,
        redirectUri,
        state,
      }),
    };
  }

  /** Callback público (sem sessão) — gerencia a própria transação, mesmo padrão de
   * `OAuthAppsService.issueToken` (ADR 0056) e do callback OAuth de login. */
  async callback(
    provider: OAuthConnectionProvider,
    code: string | undefined,
    state: string,
  ): Promise<{ redirectUrl: string }> {
    const fail = (errorCode: string) => ({
      redirectUrl: `${this.config.APP_URL}/integrations?status=error&provider=${provider}&error=${encodeURIComponent(errorCode)}`,
    });
    const raw = await this.redis.getdel(`integration:oauth:state:${state}`);
    if (raw === null) return fail('oauth_state_invalid');
    const stored = JSON.parse(raw) as StoredOAuthState;
    if (stored.provider !== provider) return fail('oauth_state_invalid');
    if (code === undefined) return fail('oauth_cancelled');

    const app = await withTenant(
      this.database.db,
      { tenantId: stored.tenantId, userId: stored.userId },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(integrationApps)
          .where(
            and(
              eq(integrationApps.workspaceId, stored.workspaceId),
              eq(integrationApps.provider, provider),
              isNull(integrationApps.deletedAt),
            ),
          );
        return row ?? null;
      },
    );
    if (app === null) return fail('integration_app_missing');

    let tokens;
    try {
      tokens = await this.oauthClient.exchangeCode(provider, {
        clientId: app.clientId,
        clientSecret: decryptSecret(app.clientSecretCiphertext, this.config.ENCRYPTION_KEY),
        redirectUri: this.redirectUri(provider),
        code,
      });
    } catch {
      return fail('oauth_exchange_failed');
    }

    await this.runner.run({ tenantId: stored.tenantId, userId: stored.userId }, async () => {
      const [existing] = await this.runner.tx
        .select()
        .from(integrationConnections)
        .where(
          and(
            eq(integrationConnections.workspaceId, stored.workspaceId),
            eq(integrationConnections.provider, provider),
            eq(integrationConnections.userId, stored.userId),
            isNull(integrationConnections.deletedAt),
          ),
        )
        .for('update');
      const tokenExpiresAt = new Date(Date.now() + tokens.expiresInSeconds * 1_000);
      const values = {
        accessTokenCiphertext: encryptSecret(tokens.accessToken, this.config.ENCRYPTION_KEY),
        tokenExpiresAt,
        isActive: true,
        metadata: { ...(existing?.metadata ?? {}), emailToItemEnabled: stored.emailToItemEnabled },
      };
      let connectionId: string;
      if (existing === undefined) {
        const [created] = await this.runner.tx
          .insert(integrationConnections)
          .values({
            tenantId: stored.tenantId,
            workspaceId: stored.workspaceId,
            provider,
            authKind: 'oauth',
            userId: stored.userId,
            refreshTokenCiphertext:
              tokens.refreshToken === null ? null : encryptSecret(tokens.refreshToken, this.config.ENCRYPTION_KEY),
            createdBy: stored.userId,
            ...values,
          })
          .returning({ id: integrationConnections.id });
        if (created === undefined) throw new Error('Falha ao criar conexão de integração');
        connectionId = created.id;
      } else {
        connectionId = existing.id;
        await this.runner.tx
          .update(integrationConnections)
          .set({
            ...values,
            ...(tokens.refreshToken === null
              ? {}
              : { refreshTokenCiphertext: encryptSecret(tokens.refreshToken, this.config.ENCRYPTION_KEY) }),
          })
          .where(eq(integrationConnections.id, existing.id));
      }
      this.events.recordChange({
        action: 'integration_connection.connected',
        entityType: 'integration_connection',
        entityId: connectionId,
        after: { provider, workspaceId: stored.workspaceId },
      });
      await this.events.emit({
        tenantId: stored.tenantId,
        type: 'integration_connection.changed',
        aggregateType: 'integration_connection',
        aggregateId: connectionId,
        payload: { connectionId, workspaceId: stored.workspaceId, provider, change: 'connected' },
        actorId: stored.userId,
      });
    });
    return { redirectUrl: `${this.config.APP_URL}/integrations?status=ok&provider=${provider}` };
  }

  // -------------------------------------------------------------------------- Drive/OneDrive ---

  async linkExternalFile(
    user: AuthPrincipal,
    itemId: string,
    input: { connectionId: string; externalFileId: string },
  ): Promise<ExternalFileLinkDto> {
    const [item] = await this.runner.tx
      .select({ id: items.id, boardId: items.boardId, values: items.values })
      .from(items)
      .where(eq(items.id, itemId));
    if (item === undefined) throw new NotFoundError('Item');
    await this.access.assert(
      user,
      'item.update',
      { type: 'item', item: { id: item.id, boardId: item.boardId, values: item.values } },
      'Item',
    );
    const connection = await this.ownConnection(user, input.connectionId);
    const accessToken = await this.ensureFreshAccessToken(connection);
    const metadata = await this.oauthClient.fetchFileMetadata(connection.provider as OAuthConnectionProvider, {
      accessToken,
      fileId: input.externalFileId,
    });
    const [row] = await this.runner.tx
      .insert(externalFileLinks)
      .values({
        tenantId: user.tenantId,
        itemId,
        connectionId: connection.id,
        externalFileId: input.externalFileId,
        name: metadata.name,
        url: metadata.url,
        mimeType: metadata.mimeType,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao vincular arquivo externo');
    this.events.recordChange({
      action: 'external_file_link.created',
      entityType: 'external_file_link',
      entityId: row.id,
      boardId: item.boardId,
      itemId,
      after: { name: row.name, provider: connection.provider },
    });
    return toExternalFileLinkDto(row);
  }

  async listExternalFiles(user: AuthPrincipal, itemId: string): Promise<ExternalFileLinkDto[]> {
    const [item] = await this.runner.tx
      .select({ id: items.id, boardId: items.boardId, values: items.values })
      .from(items)
      .where(eq(items.id, itemId));
    if (item === undefined) throw new NotFoundError('Item');
    await this.access.assert(
      user,
      'item.read',
      { type: 'item', item: { id: item.id, boardId: item.boardId, values: item.values } },
      'Item',
    );
    const rows = await this.runner.tx
      .select()
      .from(externalFileLinks)
      .where(and(eq(externalFileLinks.itemId, itemId), isNull(externalFileLinks.deletedAt)));
    return rows.map(toExternalFileLinkDto);
  }

  async unlinkExternalFile(user: AuthPrincipal, linkId: string): Promise<void> {
    const [row] = await this.runner.tx
      .select()
      .from(externalFileLinks)
      .where(and(eq(externalFileLinks.id, linkId), isNull(externalFileLinks.deletedAt)));
    if (row === undefined) throw new NotFoundError('Arquivo vinculado');
    const [item] = await this.runner.tx
      .select({ id: items.id, boardId: items.boardId, values: items.values })
      .from(items)
      .where(eq(items.id, row.itemId));
    if (item === undefined) throw new NotFoundError('Item');
    await this.access.assert(
      user,
      'item.update',
      { type: 'item', item: { id: item.id, boardId: item.boardId, values: item.values } },
      'Item',
    );
    await this.runner.tx
      .update(externalFileLinks)
      .set({ deletedAt: new Date() })
      .where(eq(externalFileLinks.id, linkId));
    this.events.recordChange({
      action: 'external_file_link.deleted',
      entityType: 'external_file_link',
      entityId: linkId,
      boardId: item.boardId,
      itemId: row.itemId,
      before: { name: row.name },
    });
  }

  // ------------------------------------------------------------------------------- utilitários ---

  /** A conexão usada precisa ser do PRÓPRIO usuário (é o token dele no Drive/OneDrive dele). */
  private async ownConnection(
    user: AuthPrincipal,
    connectionId: string,
  ): Promise<typeof integrationConnections.$inferSelect> {
    const [row] = await this.runner.tx
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, connectionId),
          eq(integrationConnections.tenantId, user.tenantId),
          eq(integrationConnections.userId, user.userId),
          eq(integrationConnections.authKind, 'oauth'),
          eq(integrationConnections.isActive, true),
          isNull(integrationConnections.deletedAt),
        ),
      );
    if (row === undefined)
      throw new ValidationError([
        { path: 'body.connectionId', message: 'Conexão Google/Microsoft inexistente ou de outro usuário.' },
      ]);
    return row;
  }

  /** Renova o `access_token` quando está vencido (ou perto disso) antes de uma chamada à API do
   * provedor — refresh-se-necessário em vez de esperar um 401, mais simples e sem retentativa. */
  private async ensureFreshAccessToken(
    connection: typeof integrationConnections.$inferSelect,
  ): Promise<string> {
    const freshEnough =
      connection.tokenExpiresAt !== null &&
      connection.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS;
    if (freshEnough && connection.accessTokenCiphertext !== null)
      return decryptSecret(connection.accessTokenCiphertext, this.config.ENCRYPTION_KEY);
    if (connection.refreshTokenCiphertext === null)
      throw new UnauthorizedError('oauth_token_expired', 'Conexão expirada; reconecte.');
    const [app] = await this.runner.tx
      .select()
      .from(integrationApps)
      .where(
        and(
          eq(integrationApps.workspaceId, connection.workspaceId),
          eq(integrationApps.provider, connection.provider),
          isNull(integrationApps.deletedAt),
        ),
      );
    if (app === undefined) throw new UnauthorizedError('oauth_token_expired', 'Conexão expirada; reconecte.');
    const refreshed = await this.oauthClient.refreshAccessToken(connection.provider as OAuthConnectionProvider, {
      clientId: app.clientId,
      clientSecret: decryptSecret(app.clientSecretCiphertext, this.config.ENCRYPTION_KEY),
      refreshToken: decryptSecret(connection.refreshTokenCiphertext, this.config.ENCRYPTION_KEY),
    });
    await this.runner.tx
      .update(integrationConnections)
      .set({
        accessTokenCiphertext: encryptSecret(refreshed.accessToken, this.config.ENCRYPTION_KEY),
        tokenExpiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1_000),
        ...(refreshed.refreshToken === null
          ? {}
          : { refreshTokenCiphertext: encryptSecret(refreshed.refreshToken, this.config.ENCRYPTION_KEY) }),
      })
      .where(eq(integrationConnections.id, connection.id));
    return refreshed.accessToken;
  }
}
